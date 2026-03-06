const assert = require("node:assert/strict");
const test = require("node:test");

const { CONFIG_DEFAULTS } = require("../../src/config/defaults");
const { MCP_ENV } = require("../../src/config/env-vars");
const { loadConfigFromEnvAndArgs } = require("../../src/config/server-config");

const MANAGED_ENV_NAMES = [
  MCP_ENV.PROBE_BASE_URL,
  MCP_ENV.PROBE_STATUS_PATH,
  MCP_ENV.PROBE_RESET_PATH,
  MCP_ENV.PROBE_WAIT_UNREACHABLE_RETRY_ENABLED,
  MCP_ENV.PROBE_WAIT_UNREACHABLE_MAX_RETRIES,
] as const;

function withEnv(
  overrides: Partial<Record<(typeof MANAGED_ENV_NAMES)[number], string | undefined>>,
  run: () => void,
): void {
  const before: Partial<Record<(typeof MANAGED_ENV_NAMES)[number], string | undefined>> = {};
  for (const name of MANAGED_ENV_NAMES) before[name] = process.env[name];

  for (const name of MANAGED_ENV_NAMES) {
    const next = overrides[name];
    if (typeof next === "undefined") {
      delete process.env[name];
    } else {
      process.env[name] = next;
    }
  }

  try {
    run();
  } finally {
    for (const name of MANAGED_ENV_NAMES) {
      const prev = before[name];
      if (typeof prev === "undefined") {
        delete process.env[name];
      } else {
        process.env[name] = prev;
      }
    }
  }
}

test("loads with only base URL and applies shared defaults for status/reset paths", () => {
  withEnv(
    {
      [MCP_ENV.PROBE_BASE_URL]: "http://127.0.0.1:9193",
      [MCP_ENV.PROBE_STATUS_PATH]: undefined,
      [MCP_ENV.PROBE_RESET_PATH]: undefined,
    },
    () => {
      const cfg = loadConfigFromEnvAndArgs(["node", "server"]);
      assert.equal(cfg.probeStatusPath, CONFIG_DEFAULTS.PROBE_STATUS_PATH);
      assert.equal(cfg.probeResetPath, CONFIG_DEFAULTS.PROBE_RESET_PATH);
      assert.equal(
        cfg.probeWaitUnreachableRetryEnabled,
        CONFIG_DEFAULTS.PROBE_WAIT_UNREACHABLE_RETRY_ENABLED,
      );
      assert.equal(
        cfg.probeWaitUnreachableMaxRetries,
        CONFIG_DEFAULTS.PROBE_WAIT_UNREACHABLE_MAX_RETRIES,
      );
    },
  );
});

test("applies optional env overrides for status/reset paths", () => {
  withEnv(
    {
      [MCP_ENV.PROBE_BASE_URL]: "http://127.0.0.1:9193",
      [MCP_ENV.PROBE_STATUS_PATH]: "/custom/status",
      [MCP_ENV.PROBE_RESET_PATH]: "/custom/reset",
    },
    () => {
      const cfg = loadConfigFromEnvAndArgs(["node", "server"]);
      assert.equal(cfg.probeStatusPath, "/custom/status");
      assert.equal(cfg.probeResetPath, "/custom/reset");
    },
  );
});

test("CLI overrides take precedence over env values for status/reset paths", () => {
  withEnv(
    {
      [MCP_ENV.PROBE_BASE_URL]: "http://127.0.0.1:9193",
      [MCP_ENV.PROBE_STATUS_PATH]: "/env/status",
      [MCP_ENV.PROBE_RESET_PATH]: "/env/reset",
    },
    () => {
      const cfg = loadConfigFromEnvAndArgs([
        "node",
        "server",
        "--probe-status-path",
        "/cli/status",
        "--probe-reset-path",
        "/cli/reset",
      ]);
      assert.equal(cfg.probeStatusPath, "/cli/status");
      assert.equal(cfg.probeResetPath, "/cli/reset");
    },
  );
});

test("missing base URL error does not mention status/reset path env vars", () => {
  withEnv(
    {
      [MCP_ENV.PROBE_BASE_URL]: undefined,
      [MCP_ENV.PROBE_STATUS_PATH]: undefined,
      [MCP_ENV.PROBE_RESET_PATH]: undefined,
    },
    () => {
      assert.throws(
        () => loadConfigFromEnvAndArgs(["node", "server"]),
        (err: any) => {
          assert.ok(err instanceof Error);
          assert.match(err.message, /MCP_PROBE_BASE_URL/);
          assert.doesNotMatch(err.message, /MCP_PROBE_STATUS_PATH/);
          assert.doesNotMatch(err.message, /MCP_PROBE_RESET_PATH/);
          return true;
        },
      );
    },
  );
});

test("blank status/reset env values are treated as unset and fall back to defaults", () => {
  withEnv(
    {
      [MCP_ENV.PROBE_BASE_URL]: "http://127.0.0.1:9193",
      [MCP_ENV.PROBE_STATUS_PATH]: "   ",
      [MCP_ENV.PROBE_RESET_PATH]: "\t",
    },
    () => {
      const cfg = loadConfigFromEnvAndArgs(["node", "server"]);
      assert.equal(cfg.probeStatusPath, CONFIG_DEFAULTS.PROBE_STATUS_PATH);
      assert.equal(cfg.probeResetPath, CONFIG_DEFAULTS.PROBE_RESET_PATH);
    },
  );
});

test("rejects invalid status path that does not start with slash", () => {
  withEnv(
    {
      [MCP_ENV.PROBE_BASE_URL]: "http://127.0.0.1:9193",
      [MCP_ENV.PROBE_STATUS_PATH]: "invalid-status-path",
      [MCP_ENV.PROBE_RESET_PATH]: undefined,
    },
    () => {
      assert.throws(
        () => loadConfigFromEnvAndArgs(["node", "server"]),
        (err: any) => {
          assert.ok(err instanceof Error);
          assert.match(err.message, /MCP_PROBE_STATUS_PATH/);
          assert.match(err.message, /must start with '\/'/);
          return true;
        },
      );
    },
  );
});

test("parses probe wait unreachable retry settings from env", () => {
  withEnv(
    {
      [MCP_ENV.PROBE_BASE_URL]: "http://127.0.0.1:9193",
      [MCP_ENV.PROBE_WAIT_UNREACHABLE_RETRY_ENABLED]: "true",
      [MCP_ENV.PROBE_WAIT_UNREACHABLE_MAX_RETRIES]: "7",
    },
    () => {
      const cfg = loadConfigFromEnvAndArgs(["node", "server"]);
      assert.equal(cfg.probeWaitUnreachableRetryEnabled, true);
      assert.equal(cfg.probeWaitUnreachableMaxRetries, 7);
    },
  );
});

test("clamps probe wait unreachable max retries to configured bounds", () => {
  withEnv(
    {
      [MCP_ENV.PROBE_BASE_URL]: "http://127.0.0.1:9193",
      [MCP_ENV.PROBE_WAIT_UNREACHABLE_MAX_RETRIES]: "999",
    },
    () => {
      const cfg = loadConfigFromEnvAndArgs(["node", "server"]);
      assert.equal(
        cfg.probeWaitUnreachableMaxRetries,
        CONFIG_DEFAULTS.PROBE_WAIT_UNREACHABLE_MAX_RETRIES_MAX,
      );
    },
  );

  withEnv(
    {
      [MCP_ENV.PROBE_BASE_URL]: "http://127.0.0.1:9193",
      [MCP_ENV.PROBE_WAIT_UNREACHABLE_MAX_RETRIES]: "-2",
    },
    () => {
      const cfg = loadConfigFromEnvAndArgs(["node", "server"]);
      assert.equal(
        cfg.probeWaitUnreachableMaxRetries,
        CONFIG_DEFAULTS.PROBE_WAIT_UNREACHABLE_MAX_RETRIES_MIN,
      );
    },
  );
});
