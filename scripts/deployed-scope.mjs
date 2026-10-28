import { readFile } from "node:fs/promises";
import path from "node:path";
import sourceTemplates from "../src/template-ids.json" with { type: "json" };

const deploymentRequired = (reason) => new Error(`${reason}; application deployment required`);

async function readBaselineJson(appDir, relative) {
  try {
    return JSON.parse(await readFile(path.join(appDir, relative), "utf8"));
  } catch (error) {
    throw deploymentRequired(`Cannot read deployed capability ${relative}: ${error.message}`);
  }
}

/** Merchant lists and native concrete paths are not deployment capabilities. */
export async function readDeployedBaseline(appDir) {
  if (!appDir) throw deploymentRequired("APP_DIR is required for content publication");
  const [templates, requiredFiles] = await Promise.all([
    readBaselineJson(appDir, "src/template-ids.json"),
    readBaselineJson(appDir, ".next/required-server-files.json"),
  ]);
  if (!Array.isArray(templates) || !templates.length || new Set(templates).size !== templates.length ||
    templates.some((id) => typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id))) {
    throw deploymentRequired("Invalid deployed template capabilities");
  }
  const assetPrefix = requiredFiles?.config?.assetPrefix;
  const indexing = requiredFiles?.config?.env?.SEARCH_INDEXING_ENABLED;
  if (typeof assetPrefix !== "string" || !["true", "false"].includes(indexing)) {
    throw deploymentRequired("Invalid deployed assetPrefix or SEARCH_INDEXING_ENABLED in .next/required-server-files.json");
  }
  return { templates, buildEnv: { STATIC_ASSET_PREFIX: assetPrefix, SEARCH_INDEXING_ENABLED: indexing } };
}

/** Validate installed code/configuration, not a previous merchant/page snapshot. */
export function validateDeployedCapabilities({ baseline, selected, scope, env = process.env }) {
  const needed = new Set(selected.map((site) => site.templateId));
  if (scope.scope === "template") needed.add(scope.templateId);
  for (const template of needed) {
    if (!baseline.templates.includes(template) || !sourceTemplates.includes(template)) {
      throw deploymentRequired(`Template is not installed in the application and source: ${template}`);
    }
  }
  for (const [name, value] of Object.entries(baseline.buildEnv)) {
    if (env[name] !== undefined && env[name] !== value) throw deploymentRequired(`${name} differs from deployed application`);
  }
  return baseline.buildEnv;
}
