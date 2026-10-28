import { readBuildDocument } from "./build-input.mjs";
import { readPublicDocument, resolveMerchant, SiteApiError } from "./site-api.mjs";

/** React handles render-scoped deduplication in createSiteLoader. */
export function createSiteDocumentReader({
  templateId,
  validate,
  isBuilding = () => process.env.BRAND_SITE_BUILDING === "1",
  readSnapshot = readBuildDocument,
  readPublic = readPublicDocument,
  resolve = resolveMerchant,
}) {
  return async (siteId) => {
    if (typeof siteId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(siteId)) {
      throw new SiteApiError("NOT_FOUND", "Invalid site ID", 404);
    }
    // Input preparation has already validated the fixed build document once.
    if (isBuilding()) return readSnapshot(templateId, siteId);
    const result = await readPublic(siteId);
    if (result.templateId !== templateId || result.document?.siteId !== siteId) {
      throw new SiteApiError("IDENTITY_MISMATCH", `Public document identity mismatch: ${siteId}`);
    }
    const document = validate(result.document);
    const identity = await resolve(new URL(document.siteUrl).hostname.toLowerCase().replace(/\.$/, ""));
    if (!identity) throw new SiteApiError("NOT_FOUND", "Site is no longer public", 404);
    if (identity.siteId !== siteId || identity.templateId !== templateId || identity.siteUrl !== document.siteUrl) {
      throw new SiteApiError("IDENTITY_MISMATCH", `Public document canonical identity mismatch: ${siteId}`);
    }
    return document;
  };
}
