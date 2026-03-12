import * as fs from "node:fs";
import * as path from "node:path";

type PackageContractShape = {
  version?: unknown;
};

const FALLBACK_CONTRACT_VERSION = "unknown";
let cachedContractVersion: string | undefined;

export function getContractVersion(): string {
  if (cachedContractVersion) return cachedContractVersion;

  const packageJsonPath = path.resolve(__dirname, "..", "..", "package.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as PackageContractShape;
    if (typeof parsed.version === "string" && parsed.version.trim()) {
      cachedContractVersion = parsed.version.trim();
      return cachedContractVersion;
    }
  } catch {
    // Fall through to env/fallback.
  }

  const envOverride = process.env.MCP_CONTRACT_VERSION?.trim();
  cachedContractVersion =
    envOverride && envOverride.length > 0 ? envOverride : FALLBACK_CONTRACT_VERSION;
  return cachedContractVersion;
}
