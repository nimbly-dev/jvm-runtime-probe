import * as fs from "node:fs/promises";
import * as path from "node:path";

export type ProjectRootValidation =
  | {
      ok: true;
      projectRootAbs: string;
    }
  | {
      ok: false;
      status: "project_selector_required" | "project_selector_invalid";
      nextAction: string;
      reason: string;
      value?: string;
    };

export async function validateProjectRootAbs(
  projectRootAbs: string | undefined,
): Promise<ProjectRootValidation> {
  if (typeof projectRootAbs !== "string" || projectRootAbs.trim().length === 0) {
    return {
      ok: false,
      status: "project_selector_required",
      reason: "projectRootAbs is required",
      nextAction: "Provide projectRootAbs as an absolute existing project directory path.",
    };
  }

  const trimmed = projectRootAbs.trim();
  if (!path.isAbsolute(trimmed)) {
    return {
      ok: false,
      status: "project_selector_invalid",
      reason: "projectRootAbs must be absolute",
      value: trimmed,
      nextAction: "Provide an absolute projectRootAbs path from orchestrator context.",
    };
  }

  let stat;
  try {
    stat = await fs.stat(trimmed);
  } catch {
    return {
      ok: false,
      status: "project_selector_invalid",
      reason: "projectRootAbs does not exist",
      value: trimmed,
      nextAction: "Provide an existing projectRootAbs path from orchestrator context.",
    };
  }

  if (!stat.isDirectory()) {
    return {
      ok: false,
      status: "project_selector_invalid",
      reason: "projectRootAbs must be a directory",
      value: trimmed,
      nextAction: "Provide an existing project directory path for projectRootAbs.",
    };
  }

  return {
    ok: true,
    projectRootAbs: path.resolve(trimmed),
  };
}
