import catalog from "./site-catalog.json" with { type: "json" };

export const sites = catalog;

/** @param {string} id */
export function findSite(id) {
  return sites.find((site) => site.id === id);
}

/** @param {string} [scope] */
export function selectSites(scope = "all") {
  if (scope === "all") return sites;
  const site = findSite(scope);
  if (!site) throw new Error(`Unknown site: ${scope}`);
  return [site];
}

export function getBuildSites() {
  return selectSites(process.env.BRAND_SITE_BUILD_SCOPE || "all");
}

/** @param {string} host */
export function normalizeHostname(host) {
  return host.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

/** @param {string} host */
export function findSiteByHost(host) {
  const hostname = normalizeHostname(host);
  return sites.find((site) => site.hostname === hostname);
}

/** Keep pathname-dependent UI identical before and after a host rewrite.
 * @param {string} pathname
 */
export function publicPathname(pathname) {
  return pathname.replace(/^\/sites\/[^/]+(?=\/|$)/, "") || "/";
}

/** @param {string} host @param {string} pathname @param {string} [scope] */
export function resolveSiteRequest(host, pathname, scope = "all") {
  const selected = selectSites(scope);
  const site = findSiteByHost(host);
  if (!site || !selected.some((entry) => entry.id === site.id)) return null;
  const prefix = `/sites/${site.id}`;
  if (pathname === "/sites" || pathname.startsWith("/sites/")) {
    return pathname === prefix || pathname.startsWith(`${prefix}/`)
      ? { site, pathname }
      : null;
  }
  // A regular route avoids Next's special dynamic sitemap file convention.
  const suffix = pathname === "/sitemap.xml" ? "/sitemap-data" : pathname === "/" ? "" : pathname;
  return { site, pathname: `${prefix}${suffix}` };
}
