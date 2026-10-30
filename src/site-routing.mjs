import templateIds from "./template-ids.json" with { type: "json" };

const safeId = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

/** Normalize only a Host authority, never a URL or forwarded-header list. */
export function normalizeHostname(host) {
  if (typeof host !== "string" || !host || /[\s/@,?#\\]/.test(host)) return "";
  const match = /^(\[[0-9a-fA-F:]+\]|[^:]+)(?::([0-9]+))?$/.exec(host);
  if (!match || (match[2] && (Number(match[2]) < 1 || Number(match[2]) > 65535))) return "";
  const hostname = match[1].toLowerCase().replace(/\.$/, "");
  if (hostname === "[::1]") return hostname;
  if (hostname.length > 253 || !hostname.split(".").every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))) return "";
  return hostname;
}

/** Keep pathname-dependent UI identical before and after a host rewrite. */
export function publicPathname(pathname) {
  const match = pathname.match(/^\/(?:sites\/([^/]+)\/[^/]+|preview\/([^/]+))(?=\/|$)/);
  return (match && templateIds.includes(match[1] || match[2]) ? pathname.slice(match[0].length) : pathname) || "/";
}

export function resolvePreviewRequest(host, pathname, baseDomain = "preview.localhost") {
  const hostname = normalizeHostname(host);
  const suffix = `.${baseDomain}`;
  if (!hostname.endsWith(suffix)) return null;
  const templateId = hostname.slice(0, -suffix.length);
  if (!templateIds.includes(templateId) || typeof pathname !== "string" || !pathname.startsWith("/")) return null;
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (/[\\\0]/.test(decoded) || decoded.split("/").some((part) => part === "." || part === "..")) return null;
  const prefix = `/preview/${templateId}`;
  if (decoded === "/sites" || decoded.startsWith("/sites/")) return null;
  if (decoded === "/preview" || decoded.startsWith("/preview/")) {
    return decoded === prefix || decoded.startsWith(`${prefix}/`) ? { templateId, pathname: decoded } : null;
  }
  return { templateId, pathname: prefix + (pathname === "/" ? "" : pathname === "/sitemap.xml" ? "/sitemap-data" : pathname) };
}

/** The caller supplies an API-verified identity; this module performs no I/O. */
export function resolveSiteRequest(site, pathname) {
  if (!site || typeof site.siteId !== "string" || !safeId.test(site.siteId) || !templateIds.includes(site.templateId) ||
    typeof pathname !== "string" || !pathname.startsWith("/") || pathname.includes("\\") || pathname.includes("\0")) return null;
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes("\\") || decoded.includes("\0") || decoded.split("/").some((part) => part === "." || part === "..")) return null;
  if (decoded === "/preview" || decoded.startsWith("/preview/")) return null;
  const prefix = `/sites/${site.templateId}/${site.siteId}`;
  if (decoded === "/sites" || decoded.startsWith("/sites/")) {
    return decoded === prefix || decoded.startsWith(`${prefix}/`) ? { site, pathname: decoded } : null;
  }
  // A regular route avoids Next's special dynamic sitemap file convention.
  const suffix = pathname === "/sitemap.xml" ? "/sitemap-data" : pathname === "/" ? "" : pathname;
  return { site, pathname: `${prefix}${suffix}` };
}
