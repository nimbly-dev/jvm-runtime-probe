import * as fs from "node:fs/promises";
import * as path from "node:path";

import { validateProjectRootAbs } from "../../../utils/project_root_validate.util";

async function dirExists(abs: string): Promise<boolean> {
  try {
    const st = await fs.stat(abs);
    return st.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(abs: string): Promise<boolean> {
  try {
    const st = await fs.stat(abs);
    return st.isFile();
  } catch {
    return false;
  }
}

export async function projectContextValidateDomain(input: {
  projectRootAbs?: string;
}): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
}> {
  const validated = await validateProjectRootAbs(input.projectRootAbs);
  if (!validated.ok) {
    const structuredContent = {
      resultType: "report",
      status: validated.status,
      reason: validated.reason,
      ...(validated.value ? { projectRootAbs: validated.value } : {}),
      nextAction: validated.nextAction,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
      structuredContent,
    };
  }

  const projectRootAbs = validated.projectRootAbs;
  const markers: string[] = [];
  if (await fileExists(path.join(projectRootAbs, "pom.xml"))) markers.push("pom.xml");
  if (await fileExists(path.join(projectRootAbs, "build.gradle"))) markers.push("build.gradle");
  if (await fileExists(path.join(projectRootAbs, "build.gradle.kts"))) {
    markers.push("build.gradle.kts");
  }
  const sourceRoots = [path.join(projectRootAbs, "src", "main", "java")];
  const javaSourceRoots: string[] = [];
  for (const sourceRootAbs of sourceRoots) {
    if (await dirExists(sourceRootAbs)) javaSourceRoots.push(sourceRootAbs);
  }

  const structuredContent = {
    resultType: "project_context",
    status: "ok",
    projectRootAbs,
    buildMarkers: markers,
    hasBuildMarker: markers.length > 0,
    javaSourceRoots,
    hasJavaSourceRoot: javaSourceRoots.length > 0,
  };
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}
