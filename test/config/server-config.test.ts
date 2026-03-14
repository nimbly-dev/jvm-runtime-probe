const assert = require("node:assert/strict");
const test = require("node:test");

const { CONFIG_DEFAULTS } = require("@/config/defaults");
const { MCP_ENV } = require("@/config/env-vars");
const { loadConfigFromEnvAndArgs } = require("@/config/server-config");

const MANAGED_ENV_NAMES = [
  MCP_ENV.PROBE_BASE_URL,
  MCP_ENV.PROBE_LINE_SELECTION_MAX_SCAN_LINES,
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

test("loads with only base URL and applies fixed probe path defaults", () => {
  withEnv(
    {
      [MCP_ENV.PROBE_BASE_URL]: "http://127.0.0.1:9193",
    },
    () => {
      const cfg = loadConfigFromEnvAndArgs(["node", "server"]);
      assert.equal(cfg.probeStatusPath, CONFIG_DEFAULTS.PROBE_STATUS_PATH);
      assert.equal(cfg.probeResetPath, CONFIG_DEFAULTS.PROBE_RESET_PATH);
      assert.equal(cfg.probeCapturePath, CONFIG_DEFAULTS.PROBE_CAPTURE_PATH);
      assert.equal(
        cfg.probeLineSelectionMaxScanLines,
        CONFIG_DEFAULTS.PROBE_LINE_SELECTION_MAX_SCAN_LINES,
      );
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

test("ignores legacy probe path env vars and CLI path flags", () => {
  const legacyNames = [
    "MCP_PROBE_STATUS_PATH",
    "MCP_PROBE_RESET_PATH",
    "MCP_PROBE_CAPTURE_PATH",
  ] as const;
  const before = {
    MCP_PROBE_STATUS_PATH: process.env.MCP_PROBE_STATUS_PATH,
    MCP_PROBE_RESET_PATH: process.env.MCP_PROBE_RESET_PATH,
    MCP_PROBE_CAPTURE_PATH: process.env.MCP_PROBE_CAPTURE_PATH,
  };

  try {
    withEnv(
      {
        [MCP_ENV.PROBE_BASE_URL]: "http://127.0.0.1:9193",
      },
      () => {
        process.env.MCP_PROBE_STATUS_PATH = "/legacy/status";
        process.env.MCP_PROBE_RESET_PATH = "/legacy/reset";
        process.env.MCP_PROBE_CAPTURE_PATH = "/legacy/capture";

        const cfg = loadConfigFromEnvAndArgs([
          "node",
          "server",
          "--probe-status-path",
          "/cli/status",
          "--probe-reset-path",
          "/cli/reset",
          "--probe-capture-path",
          "/cli/capture",
        ]);
        assert.equal(cfg.probeStatusPath, CONFIG_DEFAULTS.PROBE_STATUS_PATH);
        assert.equal(cfg.probeResetPath, CONFIG_DEFAULTS.PROBE_RESET_PATH);
        assert.equal(cfg.probeCapturePath, CONFIG_DEFAULTS.PROBE_CAPTURE_PATH);
      },
    );
  } finally {
    for (const name of legacyNames) {
      const prev = before[name];
      if (typeof prev === "undefined") {
        delete process.env[name];
      } else {
        process.env[name] = prev;
      }
    }
  }
});

test("missing base URL error does not mention status/reset path env vars", () => {
  withEnv(
    {
      [MCP_ENV.PROBE_BASE_URL]: undefined,
    },
    () => {
      assert.throws(
        () => loadConfigFromEnvAndArgs(["node", "server"]),
        (err: any) => {
          assert.ok(err instanceof Error);
          assert.match(err.message, /MCP_PROBE_BASE_URL/);
          assert.doesNotMatch(err.message, /MCP_PROBE_STATUS_PATH/);
          assert.doesNotMatch(err.message, /MCP_PROBE_RESET_PATH/);
          assert.doesNotMatch(err.message, /MCP_PROBE_CAPTURE_PATH/);
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
      [MCP_ENV.PROBE_LINE_SELECTION_MAX_SCAN_LINES]: "240",
      [MCP_ENV.PROBE_WAIT_UNREACHABLE_RETRY_ENABLED]: "true",
      [MCP_ENV.PROBE_WAIT_UNREACHABLE_MAX_RETRIES]: "7",
    },
    () => {
      const cfg = loadConfigFromEnvAndArgs(["node", "server"]);
      assert.equal(cfg.probeLineSelectionMaxScanLines, 240);
      assert.equal(cfg.probeWaitUnreachableRetryEnabled, true);
      assert.equal(cfg.probeWaitUnreachableMaxRetries, 7);
    },
  );
});

test("uses default line selection scan cap when env is invalid or missing", () => {
  withEnv(
    {
      [MCP_ENV.PROBE_BASE_URL]: "http://127.0.0.1:9193",
      [MCP_ENV.PROBE_LINE_SELECTION_MAX_SCAN_LINES]: "not-a-number",
    },
    () => {
      const cfg = loadConfigFromEnvAndArgs(["node", "server"]);
      assert.equal(
        cfg.probeLineSelectionMaxScanLines,
        CONFIG_DEFAULTS.PROBE_LINE_SELECTION_MAX_SCAN_LINES,
      );
    },
  );
});

test("clamps line selection scan cap to configured bounds", () => {
  withEnv(
    {
      [MCP_ENV.PROBE_BASE_URL]: "http://127.0.0.1:9193",
      [MCP_ENV.PROBE_LINE_SELECTION_MAX_SCAN_LINES]: "99999",
    },
    () => {
      const cfg = loadConfigFromEnvAndArgs(["node", "server"]);
      assert.equal(
        cfg.probeLineSelectionMaxScanLines,
        CONFIG_DEFAULTS.PROBE_LINE_SELECTION_MAX_SCAN_LINES_MAX,
      );
    },
  );

  withEnv(
    {
      [MCP_ENV.PROBE_BASE_URL]: "http://127.0.0.1:9193",
      [MCP_ENV.PROBE_LINE_SELECTION_MAX_SCAN_LINES]: "1",
    },
    () => {
      const cfg = loadConfigFromEnvAndArgs(["node", "server"]);
      assert.equal(
        cfg.probeLineSelectionMaxScanLines,
        CONFIG_DEFAULTS.PROBE_LINE_SELECTION_MAX_SCAN_LINES_MIN,
      );
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
