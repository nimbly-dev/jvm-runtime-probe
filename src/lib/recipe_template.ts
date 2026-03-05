import * as fs from "node:fs";
import * as path from "node:path";

const FALLBACK_RECIPE_OUTPUT_TEMPLATE = [
  "Reproduction Recipe",
  "===================",
  "",
  "Selected Mode: {{recipe.mode}}",
  "Routing Reason:",
  "{{recipe.mode_reason}}",
  "",
  "Steps:",
  "{{recipe.steps}}",
  "",
  "Target Key: {{probe.key}}",
  "",
  "Request Details: {{http.request}}",
  "",
  "Auth: {{auth.status}} ({{auth.strategy}})",
  "Auth Next Action: {{auth.next_action}}",
  "Auth Headers: {{auth.headers}}",
  "Auth Missing: {{auth.missing}}",
  "Auth Source: {{auth.source}}",
  "",
  "Notes: {{run.notes}}",
].join("\n");

function loadDefaultRecipeTemplateFromResource(): string {
  const templatePath = path.resolve(
    __dirname,
    "..",
    "..",
    "resources",
    "default_recipe_output.template.txt",
  );
  try {
    const text = fs.readFileSync(templatePath, "utf8");
    return text.trimEnd();
  } catch {
    return FALLBACK_RECIPE_OUTPUT_TEMPLATE;
  }
}

export const DEFAULT_RECIPE_OUTPUT_TEMPLATE = loadDefaultRecipeTemplateFromResource();

export type RecipeTemplateModel = Record<string, string>;

const TOKEN_RX = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

function resolveToken(model: RecipeTemplateModel, token: string): string | undefined {
  if (token in model) return model[token];
  const lower = token.toLowerCase();
  if (lower in model) return model[lower];
  return undefined;
}

export function renderRecipeTemplate(
  template: string,
  model: RecipeTemplateModel,
): string {
  return template.replace(TOKEN_RX, (full, key: string) => {
    const resolved = resolveToken(model, key.trim());
    // Keep unknown variables unchanged for maximum template freedom.
    return typeof resolved === "string" ? resolved : full;
  });
}
