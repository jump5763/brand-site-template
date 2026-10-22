import { readFile } from "node:fs/promises";
import path from "node:path";
import templateIds from "../src/template-ids.json" with { type: "json" };

const safeId = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

export function normalizeCatalog(entries) {
  if (!Array.isArray(entries) || !entries.length) throw new Error("Empty or invalid site catalog");
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

async function apiJson(baseUrl, endpoint, token) {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${endpoint}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Content API ${endpoint}: HTTP ${response.status}`);
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error(`Content API ${endpoint}: expected JSON`);
  try { return await response.json(); } catch { throw new Error(`Content API ${endpoint}: invalid JSON`); }
}

export async function readApiCatalog(baseUrl, token) {
  if (!baseUrl) throw new Error("CONTENT_API_URL is required");
  return normalizeCatalog((await apiJson(baseUrl, "/sites", token)).sites);
}

export async function validateDocuments(documents) {
  await Promise.all(documents.map(async ({ config, document }) => {
    if (!templateIds.includes(config.templateId)) throw new Error(`Unregistered template: ${config.templateId}`);
    const { assertValidSiteDocument } = await import(`../src/templates/${config.templateId}/site-schema/runtime/validator.mjs`);
    assertValidSiteDocument(document);
    if (document.siteId !== config.id || new URL(document.siteUrl).hostname !== config.hostname ||
      (config.siteUrl && document.siteUrl !== config.siteUrl)) throw new Error(`Site identity mismatch: ${config.id}`);
  }));
  return documents;
}

export async function readApiDocuments(baseUrl, selected, token) {
  const documents = await Promise.all(selected.map(async (config) => {
    const result = await apiJson(baseUrl, `/sites/${encodeURIComponent(config.id)}/content`, token);
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

export async function readDeployedCatalog(appDir) {
  if (!appDir) throw new Error("APP_DIR is required for content publication");
  const catalog = JSON.parse(await readFile(path.join(appDir, "site-catalog.json"), "utf8"));
  return normalizeCatalog(catalog.map((site) => ({ ...site, siteId: site.id })));
}
