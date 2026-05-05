const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { MCP_ENV } = require("@/config/env-vars");
const { loadConfigFromEnvAndArgs } = require("@/config/server-config");

const FIXTURE = path.resolve(__dirname, "fixtures", "probe-config.sample.json");
const MANAGED_ENV_NAMES = [
  MCP_ENV.WORKSPACE_ROOT,
  MCP_ENV.PROBE_BASE_URL,
  MCP_ENV.PROBE_CONFIG_FILE,
  MCP_ENV.PROBE_PROFILE,
] as const;

function withEnv(
  overrides: Partial<Record<(typeof MANAGED_ENV_NAMES)[number], string | undefined>>,
  run: () => void,
): void {
  const before: Partial<Record<(typeof MANAGED_ENV_NAMES)[number], string | undefined>> = {};
  for (const name of MANAGED_ENV_NAMES) before[name] = process.env[name];
  for (const name of MANAGED_ENV_NAMES) {
    const next = overrides[name];
    if (typeof next === "undefined") delete process.env[name];
    else process.env[name] = next;
  }
  try {
    run();
  } finally {
    for (const name of MANAGED_ENV_NAMES) {
      const prev = before[name];
      if (typeof prev === "undefined") delete process.env[name];
      else process.env[name] = prev;
    }
  }
}

test("loads probe base URL from configured default probe in registry", () => {
  withEnv(
    {
      [MCP_ENV.WORKSPACE_ROOT]: "C:\\workspace\\orders-platform",
      [MCP_ENV.PROBE_CONFIG_FILE]: FIXTURE,
      [MCP_ENV.PROBE_BASE_URL]: undefined,
      [MCP_ENV.PROBE_PROFILE]: undefined,
    },
    () => {
      const cfg = loadConfigFromEnvAndArgs(["node", "server"]);
      assert.equal(cfg.probeBaseUrl, "http://127.0.0.1:9190");
      assert.equal(cfg.probeRegistry?.activeProfile, "dev");
      assert.equal(cfg.probeRegistry?.profileSource, "workspace");
      assert.equal(cfg.probeRegistry?.defaultProbeId, "order-service");
      assert.equal(cfg.probeRegistry?.allowNonWrappedExecutable, false);
    },
  );
});

test("env profile override wins over workspace mapping", () => {
  withEnv(
    {
      [MCP_ENV.WORKSPACE_ROOT]: "C:\\workspace\\orders-platform",
      [MCP_ENV.PROBE_CONFIG_FILE]: FIXTURE,
      [MCP_ENV.PROBE_PROFILE]: "prod",
      [MCP_ENV.PROBE_BASE_URL]: undefined,
    },
    () => {
      const cfg = loadConfigFromEnvAndArgs(["node", "server"]);
      assert.equal(cfg.probeBaseUrl, "http://127.0.0.1:9390");
      assert.equal(cfg.probeRegistry?.activeProfile, "prod");
      assert.equal(cfg.probeRegistry?.profileSource, "env");
    },
  );
});

test("auto-discovers workspace .mcpjvm/probe-config.json when env path is not set", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-probe-registry-"));
  try {
    const workspaceRoot = path.join(tmpRoot, "workspace");
    const mcpjvmDir = path.join(workspaceRoot, ".mcpjvm");
    fs.mkdirSync(mcpjvmDir, { recursive: true });
    fs.copyFileSync(FIXTURE, path.join(mcpjvmDir, "probe-config.json"));

    withEnv(
      {
        [MCP_ENV.WORKSPACE_ROOT]: "C:\\workspace\\orders-platform",
        [MCP_ENV.PROBE_CONFIG_FILE]: undefined,
        [MCP_ENV.PROBE_PROFILE]: undefined,
      },
      () => {
        const cfg = loadConfigFromEnvAndArgs([
          "node",
          "server",
          "--workspace-root",
          workspaceRoot,
        ]);
        assert.equal(
          cfg.probeRegistry?.configFileAbs,
          path.join(workspaceRoot, ".mcpjvm", "probe-config.json"),
        );
      },
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("loads BOM-prefixed probe registry JSON", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-probe-registry-bom-"));
  try {
    const cfgPath = path.join(tmpRoot, "probe-config.json");
    const raw = fs.readFileSync(FIXTURE, "utf8");
    fs.writeFileSync(cfgPath, `\ufeff${raw}`, "utf8");

    withEnv(
      {
        [MCP_ENV.WORKSPACE_ROOT]: "C:\\workspace\\orders-platform",
        [MCP_ENV.PROBE_CONFIG_FILE]: cfgPath,
        [MCP_ENV.PROBE_PROFILE]: "dev",
        [MCP_ENV.PROBE_BASE_URL]: undefined,
      },
      () => {
        const cfg = loadConfigFromEnvAndArgs(["node", "server"]);
        assert.equal(cfg.probeRegistry?.activeProfile, "dev");
        assert.equal(cfg.probeBaseUrl, "http://127.0.0.1:9190");
      },
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
