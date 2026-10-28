import { readFile } from "node:fs/promises";
import path from "node:path";
import templateIds from "../src/template-ids.json" with { type: "json" };
import { createSiteApi } from "../src/server/site-api.mjs";

const safeId = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

export function normalizeScope(value = { scope: "all" }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid publication scope");
  const field = value.scope === "site" ? "siteId" : value.scope === "template" ? "templateId" : null;
  const keys = Object.keys(value).sort();
  if (value.scope === "all" && keys.join(",") === "scope") return { scope: "all" };
  if (!field || keys.join(",") !== ["scope", field].sort().join(",") || typeof value[field] !== "string" || !safeId.test(value[field])) {
    throw new Error("Choose exactly one valid all, template or site scope");
  }
  return { scope: value.scope, [field]: value[field] };
}

export const scopeLabel = (scope) => scope.scope === "all" ? "all" : scope.scope === "template" ? `template-${scope.templateId}` : scope.siteId;

export function normalizeCatalog(entries, { allowEmpty = false } = {}) {
  if (!Array.isArray(entries) || (!allowEmpty && !entries.length)) throw new Error("Empty or invalid site catalog");
  const ids = new Set();
  const hosts = new Set();
  return entries.map((entry) => {
    if (!entry || typeof entry.siteId !== "string" || !safeId.test(entry.siteId) || !templateIds.includes(entry.templateId)) throw new Error("Invalid site ID or unregistered template");
    const url = new URL(entry.siteUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
      throw new Error(`Invalid site URL: ${entry.siteId}`);
    }
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if (ids.has(entry.siteId) || hosts.has(hostname)) throw new Error("Duplicate site ID or hostname");
    ids.add(entry.siteId);
    hosts.add(hostname);
    return { id: entry.siteId, name: entry.name || entry.siteId, templateId: entry.templateId, hostname, siteUrl: entry.siteUrl,
      contentFile: `sites/${entry.siteId}/current.json` };
  });
}

/** The API response must already match the requested scope; never hide extra targets. */
export async function readApiCatalog(baseUrl, token, requestedScope = { scope: "all" }) {
  const scope = normalizeScope(requestedScope);
  const catalog = normalizeCatalog(await createSiteApi({ baseUrl, token }).listPublicSites(scope), { allowEmpty: true });
  if (scope.scope === "site" && (catalog.length !== 1 || catalog[0].id !== scope.siteId)) throw new Error(`API site scope mismatch or missing site: ${scope.siteId}`);
  if (scope.scope === "template" && catalog.some((site) => site.templateId !== scope.templateId)) throw new Error(`API template scope mismatch: ${scope.templateId}`);
  return catalog;
}

export async function validateDocuments(documents) {
  await Promise.all(documents.map(async ({ config, document }) => {
    if (!templateIds.includes(config.templateId)) throw new Error(`Unregistered template: ${config.templateId}`);
    const { assertValidSiteDocument } = await import(`../src/templates/${config.templateId}/site-schema/runtime/validator.mjs`);
    assertValidSiteDocument(document);
    if (document.siteId !== config.id || new URL(document.siteUrl).hostname.toLowerCase().replace(/\.$/, "") !== config.hostname ||
      (config.siteUrl && document.siteUrl !== config.siteUrl)) throw new Error(`Site identity mismatch: ${config.id}`);
  }));
  return documents;
}

export async function readApiDocuments(baseUrl, selected, token) {
  const api = createSiteApi({ baseUrl, token });
  const documents = await Promise.all(selected.map(async (config) => {
    const result = await api.readPublicDocument(config.id);
    if (result.templateId !== config.templateId) throw new Error(`Template mismatch: ${config.id}; application deployment required`);
    return { config, document: result.document };
  }));
  return validateDocuments(documents);
}

export async function readLocalDocuments(root, selected) {
  return validateDocuments(await Promise.all(selected.map(async (config) => ({
    config, document: JSON.parse(await readFile(path.join(root, config.contentFile), "utf8")),
  }))));
}

/** Only upload/inspection of this existing build uses its fixed input list. */
export async function readBuildCatalog(appDir) {
  if (!appDir) throw new Error("APP_DIR is required for artifact upload");
  const catalog = JSON.parse(await readFile(path.join(appDir, "build-input/sites.json"), "utf8"));
  return normalizeCatalog(catalog.map((site) => ({ ...site, siteId: site.id })));
}

export function selectCatalogScope(catalog, requestedScope) {
  const scope = normalizeScope(requestedScope);
  const selected = scope.scope === "all" ? catalog : catalog.filter((site) => scope.scope === "site" ? site.id === scope.siteId : site.templateId === scope.templateId);
  if (scope.scope === "site" && selected.length !== 1) throw new Error(`Unknown site in this input: ${scope.siteId}`);
  return selected;
}
