import { cache } from "react";
import { notFound } from "next/navigation";
import { findSite } from "./site-routing.mjs";
import { siteData } from "./site-data";

/** Build preparation generates explicit JSON imports for selected sites. */
export function createSiteLoader<T extends { siteId: string; siteUrl: string }>(
  templateId: string,
  validate: (value: unknown) => T,
) {
  return cache(async (siteId: string): Promise<T> => {
    const config = findSite(siteId);
    if (!config || config.templateId !== templateId) notFound();
    const site = validate(siteData[siteId]);
    if (site.siteId !== config.id || new URL(site.siteUrl).hostname !== config.hostname) {
      throw new Error(`Site identity or hostname mismatch: ${siteId}`);
    }
    return site;
  });
}
