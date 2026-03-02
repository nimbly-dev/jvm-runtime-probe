#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const cp = require("node:child_process");

function usage() {
  console.log(`mcp-jvm-debugger installer

Usage:
  node scripts/install-integrations.js [options]

Options:
  --client <codex|kiro|both>      Target client(s). Default: both
  --server-name <name>            MCP server name. Default: mcp-jvm-debugger
  --skill-name <name>             Skill folder name in ./skills. Default: mcp-jvm-repro-orchestration
  --probe-base-url <url>          Default: http://127.0.0.1:9193
  --probe-status-path <path>      Default: /__probe/status
  --probe-reset-path <path>       Default: /__probe/reset
  --probe-actuate-path <path>     Default: /__probe/actuate
  --workspace-root <absPath>      Optional MCP_WORKSPACE_ROOT value
  --codex-home <absPath>          Override CODEX_HOME (default: ~/.codex)
  --kiro-config <absPath>         Override Kiro MCP config path
  --kiro-skills-dir <absPath>     Override Kiro skills directory
  --skip-skill                    Install MCP only
  --skip-mcp                      Install skill only
  --no-build                      Do not run build when dist/server.js is missing
  --dry-run                       Print actions without changing files/config
  --help                          Show this help
`);
}

function parseArgs(argv) {
  const out = {
    client: "both",
    serverName: "mcp-jvm-debugger",
    skillName: "mcp-jvm-repro-orchestration",
    probeBaseUrl: "http://127.0.0.1:9193",
    probeStatusPath: "/__probe/status",
    probeResetPath: "/__probe/reset",
    probeActuatePath: "/__probe/actuate",
    workspaceRoot: undefined,
    codexHome: process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
    kiroConfig: undefined,
    kiroSkillsDir: undefined,
    skipSkill: false,
    skipMcp: false,
    buildIfMissing: true,
    dryRun: false,
    help: false,
  };

  const nextValue = (i, flag) => {
    if (i + 1 >= argv.length) {
      throw new Error(`Missing value for ${flag}`);
    }
    return argv[i + 1];
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
    } else if (arg === "--client") {
      out.client = nextValue(i, arg);
      i += 1;
    } else if (arg === "--server-name") {
      out.serverName = nextValue(i, arg);
      i += 1;
    } else if (arg === "--skill-name") {
      out.skillName = nextValue(i, arg);
      i += 1;
    } else if (arg === "--probe-base-url") {
      out.probeBaseUrl = nextValue(i, arg);
      i += 1;
    } else if (arg === "--probe-status-path") {
      out.probeStatusPath = nextValue(i, arg);
      i += 1;
    } else if (arg === "--probe-reset-path") {
      out.probeResetPath = nextValue(i, arg);
      i += 1;
    } else if (arg === "--probe-actuate-path") {
      out.probeActuatePath = nextValue(i, arg);
      i += 1;
    } else if (arg === "--workspace-root") {
      out.workspaceRoot = nextValue(i, arg);
      i += 1;
    } else if (arg === "--codex-home") {
      out.codexHome = nextValue(i, arg);
      i += 1;
    } else if (arg === "--kiro-config") {
      out.kiroConfig = nextValue(i, arg);
      i += 1;
    } else if (arg === "--kiro-skills-dir") {
      out.kiroSkillsDir = nextValue(i, arg);
      i += 1;
    } else if (arg === "--skip-skill") {
      out.skipSkill = true;
    } else if (arg === "--skip-mcp") {
      out.skipMcp = true;
    } else if (arg === "--no-build") {
      out.buildIfMissing = false;
    } else if (arg === "--dry-run") {
      out.dryRun = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!["codex", "kiro", "both"].includes(out.client)) {
    throw new Error(`Invalid --client value: ${out.client}`);
  }
  out.codexHome = path.resolve(expandHome(out.codexHome));
  if (out.kiroConfig) out.kiroConfig = path.resolve(expandHome(out.kiroConfig));
  if (out.kiroSkillsDir) out.kiroSkillsDir = path.resolve(expandHome(out.kiroSkillsDir));
  if (out.workspaceRoot) out.workspaceRoot = path.resolve(expandHome(out.workspaceRoot));
  return out;
}

function run(command, args, label) {
  const result = cp.spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
    shell: process.platform === "win32",
  });
  if (result.error) {
    throw new Error(`${label} failed: ${result.error.message}`);
  }
  return result;
}

function expandHome(inputPath) {
  if (!inputPath) return inputPath;
  if (inputPath === "~") return os.homedir();
  if (inputPath.startsWith("~/") || inputPath.startsWith("~\\")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function ensureFileBuilt(serverJsPath, dryRun, buildIfMissing) {
  if (fs.existsSync(serverJsPath)) return;
  if (!buildIfMissing) {
    throw new Error(`Missing ${serverJsPath}. Run npm run build first or remove --no-build.`);
  }
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  console.log(`- dist/server.js not found. Running ${npmCmd} run build`);
  if (dryRun) return;
  const build = run(npmCmd, ["run", "build"], "build");
  if (build.status !== 0) {
    throw new Error(`Build failed.\n${build.stdout}\n${build.stderr}`.trim());
  }
}

function ensureDir(dir, dryRun) {
  if (dryRun) return;
  fs.mkdirSync(dir, { recursive: true });
}

function copyDirIfMissing(source, dest, dryRun, label) {
  if (!fs.existsSync(source)) {
    throw new Error(`${label} source not found: ${source}`);
  }
  if (fs.existsSync(dest)) {
    console.log(`- ${label}: already installed, skipping (${dest})`);
    return "skipped";
  }
  console.log(`- ${label}: installing to ${dest}`);
  if (dryRun) return "created";
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(source, dest, { recursive: true });
  return "created";
}

function detectKiroConfigPath() {
  const home = os.homedir();
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return [
      path.join(appData, "Kiro", "User", "mcp.json"),
      path.join(appData, "Kiro", "User", "settings.json"),
      path.join(home, ".kiro", "mcp.json"),
    ];
  }
  if (process.platform === "darwin") {
    return [
      path.join(home, "Library", "Application Support", "Kiro", "User", "mcp.json"),
      path.join(home, "Library", "Application Support", "Kiro", "User", "settings.json"),
      path.join(home, ".kiro", "mcp.json"),
    ];
  }
  return [
    path.join(home, ".config", "Kiro", "User", "mcp.json"),
    path.join(home, ".config", "Kiro", "User", "settings.json"),
    path.join(home, ".kiro", "mcp.json"),
  ];
}

function detectKiroSkillsDir() {
  const home = os.homedir();
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(appData, "Kiro", "User", "skills");
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Kiro", "User", "skills");
  }
  return path.join(home, ".config", "Kiro", "User", "skills");
}

function getJsonFile(pathAbs) {
  if (!fs.existsSync(pathAbs)) return {};
  const raw = fs.readFileSync(pathAbs, "utf8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse JSON: ${pathAbs}\n${String(err)}`);
  }
}

function writeJsonFile(pathAbs, value, dryRun) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  if (dryRun) return;
  fs.mkdirSync(path.dirname(pathAbs), { recursive: true });
  fs.writeFileSync(pathAbs, content, "utf8");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tomlBasicString(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function tomlLiteralString(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function installKiroMcp(opts, serverJsPath) {
  const candidates = opts.kiroConfig ? [opts.kiroConfig] : detectKiroConfigPath();
  const configPath =
    candidates.find((p) => fs.existsSync(p)) || candidates[0];
  if (!configPath) {
    throw new Error("Unable to resolve Kiro config path.");
  }

  const doc = getJsonFile(configPath);
  if (doc === null || Array.isArray(doc) || typeof doc !== "object") {
    throw new Error(`Kiro config root must be an object: ${configPath}`);
  }
  if (!doc.mcpServers || typeof doc.mcpServers !== "object" || Array.isArray(doc.mcpServers)) {
    doc.mcpServers = {};
  }

  if (doc.mcpServers[opts.serverName]) {
    console.log(`- Kiro MCP: '${opts.serverName}' already configured, skipping (${configPath})`);
    return "skipped";
  }

  const env = {
    MCP_PROBE_BASE_URL: opts.probeBaseUrl,
    MCP_PROBE_STATUS_PATH: opts.probeStatusPath,
    MCP_PROBE_RESET_PATH: opts.probeResetPath,
    MCP_PROBE_ACTUATE_PATH: opts.probeActuatePath,
  };
  if (opts.workspaceRoot) {
    env.MCP_WORKSPACE_ROOT = opts.workspaceRoot;
  }

  doc.mcpServers[opts.serverName] = {
    command: "node",
    args: [serverJsPath],
    env,
  };
  console.log(`- Kiro MCP: adding '${opts.serverName}' to ${configPath}`);
  writeJsonFile(configPath, doc, opts.dryRun);
  return "created";
}

function installCodexMcp(opts, serverJsPath) {
  const configPath = path.join(opts.codexHome, "config.toml");
  const raw = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  const blockRx = new RegExp(
    `^\\[mcp_servers\\.${escapeRegex(opts.serverName)}\\]\\s*$`,
    "m",
  );
  if (blockRx.test(raw)) {
    console.log(`- Codex MCP: '${opts.serverName}' already configured, skipping (${configPath})`);
    return "skipped";
  }

  const lines = [];
  if (raw.trim().length > 0 && !raw.endsWith("\n")) {
    lines.push("");
  }
  lines.push(`[mcp_servers.${opts.serverName}]`);
  lines.push(`command = ${tomlBasicString("node")}`);
  lines.push(`args = [${tomlLiteralString(serverJsPath)}]`);
  lines.push("");
  lines.push(`[mcp_servers.${opts.serverName}.env]`);
  lines.push(`MCP_PROBE_BASE_URL = ${tomlBasicString(opts.probeBaseUrl)}`);
  lines.push(`MCP_PROBE_STATUS_PATH = ${tomlBasicString(opts.probeStatusPath)}`);
  lines.push(`MCP_PROBE_RESET_PATH = ${tomlBasicString(opts.probeResetPath)}`);
  lines.push(`MCP_PROBE_ACTUATE_PATH = ${tomlBasicString(opts.probeActuatePath)}`);
  if (opts.workspaceRoot) {
    lines.push(`MCP_WORKSPACE_ROOT = ${tomlLiteralString(opts.workspaceRoot)}`);
  }
  lines.push("");

  console.log(`- Codex MCP: adding '${opts.serverName}' to ${configPath}`);
  if (opts.dryRun) return "created";
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.appendFileSync(configPath, `${lines.join("\n")}\n`, "utf8");
  return "created";
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    usage();
    return;
  }

  const repoRoot = path.resolve(__dirname, "..");
  const serverJsPath = path.join(repoRoot, "dist", "server.js");
  const skillSource = path.join(repoRoot, "skills", opts.skillName);

  console.log(`Installing integrations (client=${opts.client}, dryRun=${opts.dryRun})`);
  if (!opts.skipMcp) {
    ensureFileBuilt(serverJsPath, opts.dryRun, opts.buildIfMissing);
  }

  const stats = {
    codexSkill: "n/a",
    codexMcp: "n/a",
    kiroSkill: "n/a",
    kiroMcp: "n/a",
  };

  if (opts.client === "codex" || opts.client === "both") {
    if (!opts.skipSkill) {
      const codexSkillDir = path.join(opts.codexHome, "skills", opts.skillName);
      ensureDir(path.dirname(codexSkillDir), opts.dryRun);
      stats.codexSkill = copyDirIfMissing(skillSource, codexSkillDir, opts.dryRun, "Codex skill");
    }
    if (!opts.skipMcp) {
      stats.codexMcp = installCodexMcp(opts, serverJsPath);
    }
  }

  if (opts.client === "kiro" || opts.client === "both") {
    if (!opts.skipSkill) {
      const kiroSkillsDir = opts.kiroSkillsDir || detectKiroSkillsDir();
      const kiroSkillDest = path.join(kiroSkillsDir, opts.skillName);
      ensureDir(path.dirname(kiroSkillDest), opts.dryRun);
      stats.kiroSkill = copyDirIfMissing(skillSource, kiroSkillDest, opts.dryRun, "Kiro skill");
    }
    if (!opts.skipMcp) {
      stats.kiroMcp = installKiroMcp(opts, serverJsPath);
    }
  }

  console.log("Done.");
  console.log(JSON.stringify(stats, null, 2));
}

try {
  main();
} catch (err) {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
}
