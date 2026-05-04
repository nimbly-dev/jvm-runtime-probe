import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

import type {
  HttpTransportRequest,
  TransportAdapter,
  TransportExecuteInput,
  TransportExecutionResult,
  TransportProtocol,
} from "@tools-regression-execution-plan-spec/models/regression_transport.model";

type CommandResult = { code: number; stdout: string; stderr: string };
type RunCommand = (command: string, args: string[], timeoutMs: number) => Promise<CommandResult>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function defaultRunCommand(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: 124, stdout, stderr: `${stderr}\ncommand_timeout` });
    }, timeoutMs);
    child.stdout.on("data", (buf) => {
      stdout += String(buf);
    });
    child.stderr.on("data", (buf) => {
      stderr += String(buf);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: typeof code === "number" ? code : 1, stdout, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: `${stderr}\n${String(err.message ?? err)}` });
    });
  });
}

function toBodyPreview(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 2048) return trimmed;
  return trimmed.slice(0, 2048);
}

function validateHttpPayload(payload: Record<string, unknown>): HttpTransportRequest | null {
  const method = asString(payload.method);
  const url = asString(payload.url);
  if (!method || !url) return null;
  const headers: Record<string, string> = {};
  if (isRecord(payload.headers)) {
    for (const [k, v] of Object.entries(payload.headers)) {
      const val = asString(v);
      if (val) headers[k] = val;
    }
  }
  return {
    method: method.toUpperCase(),
    url,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(asString(payload.body) ? { body: asString(payload.body)! } : {}),
    ...(asNumber(payload.timeoutMs) ? { timeoutMs: asNumber(payload.timeoutMs)! } : {}),
  };
}

function elapsedMs(startMs: number): number {
  const raw = performance.now() - startMs;
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.max(1, Math.round(raw));
}

export function createHttpCurlTransportAdapter(runCommand: RunCommand = defaultRunCommand): TransportAdapter {
  return {
    protocol: "http",
    async execute(input: TransportExecuteInput): Promise<TransportExecutionResult> {
      const start = performance.now();
      const parsed = validateHttpPayload(input.payload);
      if (!parsed) {
        return {
          status: "blocked_invalid",
          protocol: "http",
          durationMs: elapsedMs(start),
          reasonCode: "http_payload_invalid",
          errorMessage: "http transport requires method and url",
        };
      }

      const args: string[] = [
        "--silent",
        "--show-error",
        "--location",
        "--request",
        parsed.method,
        "--url",
        parsed.url,
        "--write-out",
        "\n__MCP_HTTP_CODE__:%{http_code}",
      ];
      if (parsed.headers) {
        for (const [k, v] of Object.entries(parsed.headers)) {
          args.push("--header", `${k}: ${v}`);
        }
      }
      if (typeof parsed.body === "string") {
        args.push("--data-raw", parsed.body);
      }

      const timeoutMs = parsed.timeoutMs ?? 20000;
      const commandResult = await runCommand("curl.exe", args, timeoutMs);
      const durationMs = elapsedMs(start);

      const marker = "__MCP_HTTP_CODE__:";
      const markerIdx = commandResult.stdout.lastIndexOf(marker);
      const bodyPart = markerIdx >= 0 ? commandResult.stdout.slice(0, markerIdx) : commandResult.stdout;
      const codePart = markerIdx >= 0 ? commandResult.stdout.slice(markerIdx + marker.length).trim() : "";
      const statusCode = Number.parseInt(codePart, 10);

      if (commandResult.code !== 0) {
        return {
          status: "blocked_runtime",
          protocol: "http",
          durationMs,
          ...(Number.isFinite(statusCode) ? { statusCode } : {}),
          bodyPreview: toBodyPreview(bodyPart),
          reasonCode: "transport_command_failed",
          errorMessage: toBodyPreview(commandResult.stderr),
        };
      }

      if (!Number.isFinite(statusCode) || statusCode <= 0) {
        return {
          status: "blocked_runtime",
          protocol: "http",
          durationMs,
          bodyPreview: toBodyPreview(bodyPart),
          reasonCode: "http_status_missing",
          errorMessage: "curl response did not include parseable http status code",
        };
      }

      return {
        status: statusCode >= 200 && statusCode < 400 ? "pass" : "fail_http",
        protocol: "http",
        statusCode,
        durationMs,
        bodyPreview: toBodyPreview(bodyPart),
      };
    },
  };
}

export function createTransportRegistry(adapters: TransportAdapter[]): Map<TransportProtocol, TransportAdapter> {
  const registry = new Map<TransportProtocol, TransportAdapter>();
  for (const adapter of adapters) {
    registry.set(adapter.protocol, adapter);
  }
  return registry;
}

export async function executeTransportWithRegistry(args: {
  protocol: TransportProtocol;
  payload: Record<string, unknown>;
  registry: Map<TransportProtocol, TransportAdapter>;
}): Promise<TransportExecutionResult> {
  const adapter = args.registry.get(args.protocol);
  if (!adapter) {
    return {
      status: "blocked_invalid",
      protocol: args.protocol,
      durationMs: 0,
      reasonCode: "transport_not_supported",
      errorMessage: `No transport adapter registered for protocol=${args.protocol}`,
    };
  }
  return adapter.execute({ protocol: args.protocol, payload: args.payload });
}

