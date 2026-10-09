import type { MetadataRoute } from "next";
import {
  loadSiteSchema,
  type SiteDocument,
} from "@/site-schema/runtime/load-site";

export function buildRobots(site: SiteDocument): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: new URL("/sitemap.xml", site.siteUrl).toString(),
  };
}

export default async function robots(): Promise<MetadataRoute.Robots> {
  return buildRobots(await loadSiteSchema());
}
