import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const safeId = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const inputRoot = () => process.env.BRAND_SITE_BUILD_INPUT_ROOT || process.cwd();

/** Fixed task inputs are files, never a source-code import or online authority. */
export function getBuildSites(root = inputRoot()) {
  const sites = JSON.parse(readFileSync(path.join(root, "build-input/sites.json"), "utf8"));
  if (!Array.isArray(sites) || sites.some((site) => !site || typeof site.id !== "string" || !safeId.test(site.id) ||
    typeof site.templateId !== "string" || !safeId.test(site.templateId) || site.contentFile !== `sites/${site.id}/current.json`)) {
    throw new Error("Invalid fixed build input");
  }
  return sites;
}

export function sitesForTemplate(templateId, root = inputRoot()) {
  return getBuildSites(root).filter((site) => site.templateId === templateId);
}

export async function readBuildDocument(templateId, siteId, root = inputRoot()) {
  const config = getBuildSites(root).find((site) => site.id === siteId);
  if (!config || config.templateId !== templateId) throw new Error(`Site missing from fixed build input: ${siteId}`);
  const document = JSON.parse(await readFile(path.join(root, config.contentFile), "utf8"));
  if (document.siteId !== siteId || new URL(document.siteUrl).hostname !== config.hostname ||
    (config.siteUrl && document.siteUrl !== config.siteUrl)) throw new Error(`Fixed input identity mismatch: ${siteId}`);
  return document;
}

/** Preview input is fixed with the application, never a merchant API response. */
export async function readPreviewDocument(templateId, root = inputRoot()) {
  if (!safeId.test(templateId)) throw new Error("Invalid preview template ID");
  return JSON.parse(await readFile(path.join(root, "previews", `${templateId}.json`), "utf8"));
}
