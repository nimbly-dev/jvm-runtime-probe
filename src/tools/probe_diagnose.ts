import { fetchJson } from "../lib/http";
import { clampInt, DEFAULT_PROBE_TIMEOUT_MS, HARD_MAX_PROBE_TIMEOUT_MS } from "../lib/safety";
import { joinUrl } from "../utils/probe.util";
import { DEFAULT_RECIPE_OUTPUT_TEMPLATE, renderRecipeTemplate, type RecipeTemplateModel } from "../lib/recipe_template";

export async function probeDiagnose(args: {
  baseUrl: string;
  statusPath: string;
  resetPath: string;
  outputTemplate?: string | undefined;
  timeoutMs?: number;
}): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent: Record<string, unknown> }> {
  const timeoutMs = clampInt(
    args.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    1_000,
    HARD_MAX_PROBE_TIMEOUT_MS,
  );

  const probeKey = "mcp.jvm.diagnose#key";
  const statusUrl = new URL(joinUrl(args.baseUrl, args.statusPath));
  statusUrl.searchParams.set("key", probeKey);
  const resetUrl = joinUrl(args.baseUrl, args.resetPath);

  const checks: Record<string, unknown> = {};
  const recommendations: string[] = [];

  try {
    const reset = await fetchJson(resetUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: probeKey }),
      timeoutMs,
    });
    checks.reset = { ok: reset.status >= 200 && reset.status < 300, status: reset.status, json: reset.json };
  } catch (err) {
    checks.reset = { ok: false, error: err instanceof Error ? err.message : String(err) };
    recommendations.push("Probe reset endpoint unreachable. Confirm docker service is running and probe port mapping is correct.");
  }

  try {
    const status = await fetchJson(statusUrl.toString(), { method: "GET", timeoutMs });
    const responseKey = typeof status.json?.key === "string" ? status.json.key : undefined;
    const decodeOk = responseKey === probeKey;
    checks.status = {
      ok: status.status >= 200 && status.status < 300,
      status: status.status,
      json: status.json,
      responseKey,
      keyDecodingOk: decodeOk,
    };
    if (!decodeOk) {
      recommendations.push(
        "Probe key decoding mismatch detected. Rebuild/redeploy java-agent so query keys with # are decoded correctly.",
      );
    }
  } catch (err) {
    checks.status = { ok: false, error: err instanceof Error ? err.message : String(err) };
    recommendations.push("Probe status endpoint unreachable. If port is unknown, ask user which service probe port is mapped.");
  }

  const structuredContent: Record<string, unknown> = {
    config: {
      baseUrl: args.baseUrl,
      statusPath: args.statusPath,
      resetPath: args.resetPath,
      timeoutMs,
    },
    checks,
    recommendations,
  };
  const allOk =
    (checks.reset as any)?.ok === true &&
    (checks.status as any)?.ok === true &&
    (checks.status as any)?.keyDecodingOk !== false;
  const recipeSteps = [
    "1. [execute] Reset then query probe diagnose key",
    `   POST ${resetUrl} + GET ${statusUrl.toString()}`,
    "2. [verify] Validate reset/status reachability and key decoding",
    `   outcome=${allOk ? "healthy" : "issues_detected"}`,
  ].join("\n");
  const model: RecipeTemplateModel = {
    "recipe.mode": "probe",
    "recipe.mode_reason":
      "Direct probe diagnostic output; this is a wiring check rather than request recipe inference.",
    "recipe.steps": recipeSteps,
    "target.path": "mcp.jvm.diagnose#key",
    "probe.key": "mcp.jvm.diagnose#key",
    "http.request": `POST ${resetUrl} + GET ${statusUrl.toString()}`,
    execution_hit: allOk ? "hit" : "miss",
    api_outcome: allOk ? "ok" : "error",
    repro_status: allOk ? "diagnose_ok" : "diagnose_failed",
    "auth.status": "not_applicable",
    "auth.strategy": "none",
    "auth.next_action": "-",
    "auth.headers": "-",
    "auth.missing": "-",
    "auth.source": "-",
    "auth.login.path": "-",
    "auth.login.body": "-",
    "probe.hit": allOk ? "probe wiring healthy" : "probe wiring has issues",
    "http.code": allOk ? "200" : "error",
    "http.response": JSON.stringify(structuredContent),
    "run.duration": "Not measured",
    "run.notes": recommendations.join(" | ") || "No recommendations",
  };
  // Keep probe utility outputs machine-friendly by default to avoid recursive
  // "recipe-of-probe-call" loops in agent workflows.
  const text =
    !args.outputTemplate || args.outputTemplate.trim().length === 0
      ? JSON.stringify(
          {
            mode: "probe",
            diagnose: {
              healthy: allOk,
              probeKey,
              resetUrl,
              statusUrl: statusUrl.toString(),
              recommendations,
            },
            checks,
          },
          null,
          2,
        )
      : renderRecipeTemplate(args.outputTemplate ?? DEFAULT_RECIPE_OUTPUT_TEMPLATE, model);

  return {
    content: [{ type: "text", text }],
    structuredContent,
  };
}
