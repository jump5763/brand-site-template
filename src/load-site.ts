import { cache } from "react";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import { findSite, getBuildSites } from "./site-routing.mjs";
import { templateMap, type LoadedSite } from "./template-map";

export const loadSite = cache(async (siteId: string): Promise<LoadedSite> => {
  const config = findSite(siteId);
  if (!config || !getBuildSites().some((site) => site.id === siteId)) notFound();
  const value: unknown = JSON.parse(await readFile(path.resolve(config.contentFile), "utf8"));
  let loaded: LoadedSite;
  if (config.templateId === "a") {
    loaded = { templateId: "a", site: templateMap.a.validate(value) };
  } else if (config.templateId === "b") {
    loaded = { templateId: "b", site: templateMap.b.validate(value) };
  } else {
    throw new Error(`Unknown template: ${config.templateId}`);
  }
  if (loaded.site.siteId !== config.id) throw new Error(`Site identity mismatch: ${config.id}`);
  if (new URL(loaded.site.siteUrl).hostname !== config.hostname) {
    throw new Error(`Site URL does not match hostname: ${config.id}`);
  }
  return loaded;
});
