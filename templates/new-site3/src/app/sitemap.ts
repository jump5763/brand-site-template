import type { MetadataRoute } from "next";
import {
  loadSiteSchema,
  type SiteDocument,
} from "@/site-schema/runtime/load-site";

type SitePage = {
  path: string;
  metadata?: { robots?: { index?: boolean } };
};

function asPages(site: SiteDocument): SitePage[] {
  return Array.isArray(site.pages) ? (site.pages as SitePage[]) : [];
}

/** Keep generated URLs aligned with Next's default `trailingSlash: false`. */
export function normalizePagePath(path: string): string {
  if (!path.startsWith("/")) {
    throw new Error(`PAGE_PATH_INVALID: ${path}`);
  }
  if (path === "/") return "/";
  const normalized = `/${path.slice(1).replace(/\/+$/, "")}`;
  if (normalized === "/") return "/";
  return normalized;
}

export function pageUrl(siteUrl: string, path: string): string {
  return new URL(normalizePagePath(path), siteUrl).toString();
}

export function buildSitemap(site: SiteDocument): MetadataRoute.Sitemap {
  const seen = new Set<string>();
  const entries: MetadataRoute.Sitemap = [];
  for (const page of asPages(site)) {
    if (page.metadata?.robots?.index === false) continue;
    const url = pageUrl(site.siteUrl, page.path);
    if (seen.has(url)) throw new Error(`SITEMAP_URL_DUPLICATE: ${url}`);
    seen.add(url);
    entries.push({ url });
  }
  return entries;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return buildSitemap(await loadSiteSchema());
}
