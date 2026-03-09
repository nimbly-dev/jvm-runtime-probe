import { ProjectsDiscoverInputSchema } from "../../../models/inputs";

export const PROJECT_LIST_TOOL = {
  name: "project_list",
  description:
    "Discover Maven/Gradle Java projects under the workspace root (pom.xml / build.gradle*) and infer probe include scope from Java package declarations.",
  inputSchema: ProjectsDiscoverInputSchema,
} as const;
