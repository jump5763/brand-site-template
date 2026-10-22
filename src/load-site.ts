import { cache } from "react";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import { findSite } from "./site-routing.mjs";

/** Read schema-validated snapshots; retain tenant isolation without repeating input validation. */
export function createSiteLoader<T extends { siteId: string; siteUrl: string }>(
  templateId: string,
) {
  return cache(async (siteId: string): Promise<T> => {
    const config = findSite(siteId);
    if (!config || config.templateId !== templateId) notFound();
    if (process.env.NODE_ENV === "production" && process.env.BRAND_SITE_BUILDING !== "1") {
      throw new Error(`Online regeneration is disabled: ${siteId}`);
    }
    const site = JSON.parse(await readFile(path.join(process.cwd(), config.contentFile), "utf8")) as T;
    if (site.siteId !== config.id || new URL(site.siteUrl).hostname !== config.hostname ||
      ("siteUrl" in config && typeof config.siteUrl === "string" && site.siteUrl !== config.siteUrl)) {
      throw new Error(`Site identity or hostname mismatch: ${siteId}`);
    }
    return site;
  });
}
