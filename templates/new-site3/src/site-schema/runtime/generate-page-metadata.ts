import type { Metadata } from "next";
import type { SiteDocument } from "./load-site";

type Page = {
  id: string;
  path: string;
  metadata: {
    title: string;
    description: string;
    canonicalPath?: string;
    robots?: { index?: boolean; follow?: boolean };
    openGraph?: Record<string, unknown>;
    structuredData?: unknown;
  };
};

function findPage(site: SiteDocument, pathOrId: string): Page {
  const pages = site.pages as Page[];
  const page = pages.find(
    (candidate) => candidate.id === pathOrId || candidate.path === pathOrId,
  );
  if (!page) throw new Error(`PAGE_UNKNOWN: ${pathOrId}`);
  return page;
}

export function generatePageMetadata(
  site: SiteDocument,
  pathOrId: string,
): Metadata {
  const page = findPage(site, pathOrId);
  const canonicalPath = page.metadata.canonicalPath ?? page.path;
  const metadata: Metadata = {
    title: page.metadata.title,
    description: page.metadata.description,
    alternates: { canonical: new URL(canonicalPath, site.siteUrl).toString() },
    robots: page.metadata.robots
      ? {
          index: page.metadata.robots.index,
          follow: page.metadata.robots.follow,
        }
      : undefined,
  };
  if (page.metadata.openGraph)
    metadata.openGraph = page.metadata.openGraph as Metadata["openGraph"];
  return metadata;
}

export function getPageStructuredData(
  site: SiteDocument,
  pathOrId: string,
): unknown {
  return findPage(site, pathOrId).metadata.structuredData;
}
