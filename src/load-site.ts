import { cache } from "react";
import { notFound } from "next/navigation";
import { createSiteDocumentReader } from "./server/site-document.mjs";
import { SiteApiError } from "./server/site-api.mjs";

/** Share one public read and validation across page, layout and metadata. */
export function createSiteLoader<T extends { siteId: string; siteUrl: string }>(
  templateId: string,
  validate: (value: unknown) => T,
) {
  const readDocument = createSiteDocumentReader({ templateId, validate });
  return cache(async (siteId: string): Promise<T> => {
    try {
      return await readDocument(siteId);
    } catch (error) {
      if (error instanceof SiteApiError && error.code === "NOT_FOUND") notFound();
      throw error;
    }
  });
}
