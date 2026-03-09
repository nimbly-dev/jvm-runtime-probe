import * as fs from "node:fs/promises";
import * as path from "node:path";

async function readIfExists(fileAbs: string): Promise<string | null> {
  try {
    return await fs.readFile(fileAbs, "utf8");
  } catch {
    return null;
  }
}

export async function isSpringProject(rootAbs: string): Promise<boolean> {
  const pomText = await readIfExists(path.join(rootAbs, "pom.xml"));
  if (pomText && /(spring-boot|org\.springframework)/i.test(pomText)) return true;

  const gradleText = await readIfExists(path.join(rootAbs, "build.gradle"));
  if (gradleText && /(spring-boot|org\.springframework)/i.test(gradleText)) return true;

  const gradleKtsText = await readIfExists(path.join(rootAbs, "build.gradle.kts"));
  if (gradleKtsText && /(spring-boot|org\.springframework)/i.test(gradleKtsText)) return true;

  return false;
}
