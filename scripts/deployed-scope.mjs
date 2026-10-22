import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeCatalog } from "./content-input.mjs";

const metadataPaths = new Map([["/robots.txt", "/robots.txt"], ["/sitemap-data", "/sitemap.xml"]]);
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const deploymentRequired = (reason) => new Error(`${reason}; application deployment required`);

async function readBaselineJson(appDir, relative) {
  try {
    return JSON.parse(await readFile(path.join(appDir, relative), "utf8"));
  } catch (error) {
    throw deploymentRequired(`Cannot read deployed baseline ${relative}: ${error.message}`);
  }
}

/** Read only the deployed application; never fall back to workspace inputs. */
export async function readDeployedBaseline(appDir) {
  if (!appDir) throw deploymentRequired("APP_DIR is required for content publication");
  const [storedCatalog, prerender, requiredFiles] = await Promise.all([
    readBaselineJson(appDir, "site-catalog.json"),
    readBaselineJson(appDir, ".next/prerender-manifest.json"),
    readBaselineJson(appDir, ".next/required-server-files.json"),
  ]);
  let catalog;
  try {
    catalog = normalizeCatalog(storedCatalog.map((site) => ({ ...site, siteId: site.id })));
    if (catalog.some((site, index) => storedCatalog[index].hostname !== site.hostname)) {
      throw new Error("Stored hostname does not match siteUrl");
    }
  } catch (error) {
    throw deploymentRequired(`Invalid deployed site-catalog.json: ${error.message}`);
  }
  if (!isObject(prerender) || !isObject(prerender.routes)) {
    throw deploymentRequired("Invalid deployed .next/prerender-manifest.json routes");
  }
  const assetPrefix = requiredFiles?.config?.assetPrefix;
  const indexing = requiredFiles?.config?.env?.SEARCH_INDEXING_ENABLED;
  if (typeof assetPrefix !== "string" || !["true", "false"].includes(indexing)) {
    throw deploymentRequired("Invalid deployed assetPrefix or SEARCH_INDEXING_ENABLED in .next/required-server-files.json");
  }
  const byId = new Map(catalog.map((site) => [site.id, site]));
  const pagePaths = Object.fromEntries(catalog.map((site) => [site.id, []]));
  const metadataBySite = new Map(catalog.map((site) => [site.id, new Set()]));
  for (const [route, details] of Object.entries(prerender.routes)) {
    if (!route.startsWith("/sites/")) continue;
    const match = /^\/sites\/([^/]+)\/([^/]+)(\/.*)?$/.exec(route);
    const site = match && byId.get(match[2]);
    if (!site || site.templateId !== match[1]) {
      throw deploymentRequired(`Deployed prerender route has no matching catalog entry: ${route}`);
    }
    const publicPath = match[3] || "/";
    if (metadataPaths.has(publicPath)) {
      if (details?.routeType !== "route") throw deploymentRequired(`Invalid deployed metadata route: ${route}`);
      metadataBySite.get(site.id).add(publicPath);
    } else {
      if (details?.routeType !== "page") throw deploymentRequired(`Invalid deployed page route: ${route}`);
      pagePaths[site.id].push(publicPath);
    }
  }
  for (const site of catalog) {
    if (!pagePaths[site.id].length) throw deploymentRequired(`No deployed page paths for ${site.id}`);
    for (const [internalPath, publicPath] of metadataPaths) {
      if (!metadataBySite.get(site.id).has(internalPath)) {
        throw deploymentRequired(`Missing deployed metadata route for ${site.id}: ${publicPath}`);
      }
    }
    pagePaths[site.id].sort();
  }
  return {
    catalog,
    pagePaths,
    buildEnv: { STATIC_ASSET_PREFIX: assetPrefix, SEARCH_INDEXING_ENABLED: indexing },
  };
}

function assertSiteUnchanged(deployed, candidate) {
  if (candidate.templateId !== deployed.templateId) {
    throw deploymentRequired(`Template changed for ${deployed.id}: ${deployed.templateId} -> ${candidate.templateId}`);
  }
  if (candidate.siteUrl !== deployed.siteUrl || candidate.hostname !== deployed.hostname) {
    throw deploymentRequired(`Site address changed for ${deployed.id}: ${deployed.siteUrl} -> ${candidate.siteUrl}`);
  }
}

/** Catalogs are already normalized by content-input; preserve their fixed snapshot. */
export function selectDeployedSites({ baseline, catalog, scope = "all" }) {
  const targets = scope === "all" ? baseline.catalog : baseline.catalog.filter((site) => site.id === scope);
  if (!targets.length) throw deploymentRequired(`Unknown deployed site: ${scope}`);
  const candidates = new Map(catalog.map((site) => [site.id, site]));
  const selected = targets.map((deployed) => {
    const candidate = candidates.get(deployed.id);
    if (!candidate) throw deploymentRequired(`Deployed site missing from API catalog: ${deployed.id}`);
    assertSiteUnchanged(deployed, candidate);
    return candidate;
  });
  const deployedIds = new Set(baseline.catalog.map((site) => site.id));
  const ignoredSites = catalog.filter((site) => !deployedIds.has(site.id));
  return { selected, ignoredSites };
}

/** Reuse the selected scope; input documents have already passed schema/identity validation. */
export function validateDeployedScope({ baseline, selection, documents }) {
  const byId = new Map();
  for (const entry of documents) {
    if (byId.has(entry.config.id)) throw deploymentRequired(`Duplicate content snapshot for ${entry.config.id}`);
    byId.set(entry.config.id, entry);
  }
  const selectedDocuments = selection.selected.map((config) => {
    const entry = byId.get(config.id);
    if (!entry) throw deploymentRequired(`Content snapshot missing for deployed site: ${config.id}`);
    assertSiteUnchanged(config, entry.config);
    const expected = new Set(baseline.pagePaths[config.id]);
    const actual = new Set(entry.document.pages.map((page) => page.path));
    const added = [...actual].filter((pathname) => !expected.has(pathname)).sort();
    const removed = [...expected].filter((pathname) => !actual.has(pathname)).sort();
    if (added.length || removed.length) {
      const reasons = [added.length ? `added ${added.join(", ")}` : "", removed.length ? `removed ${removed.join(", ")}` : ""].filter(Boolean);
      throw deploymentRequired(`Page paths changed for ${config.id}: ${reasons.join("; ")}`);
    }
    return entry;
  });
  return { ...selection, documents: selectedDocuments };
}
