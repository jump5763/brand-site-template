import { cache } from "react";
import { notFound } from "next/navigation";
import { createSiteDocumentReader } from "./server/site-document.mjs";
import { readRequestHost } from "./server/request-host.mjs";
import { SiteApiError } from "./server/site-api.mjs";

/** Share one public read and validation across page, layout and metadata. */
export function createSiteLoader<T extends { siteId: string; siteUrl: string }>(
  templateId: string,
  validate: (value: unknown) => T,
) {
  const readDocument = createSiteDocumentReader({ templateId, validate });
  return cache(async (siteId: string): Promise<T> => {
    try {
      // Build inputs have no request; online identity must originate from the actual Host.
      const host = process.env.BRAND_SITE_BUILDING === "1" ? undefined : readRequestHost();
      return await readDocument(siteId, host);
    } catch (error) {
      if (error instanceof SiteApiError && error.code === "NOT_FOUND") notFound();
      throw error;
    }
  });
}
