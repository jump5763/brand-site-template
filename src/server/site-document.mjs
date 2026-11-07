import { normalizeHostname } from "../site-routing.mjs";
import { isMerchantId, normalizeMerchantDocument } from "./site-input.mjs";
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
  return async (siteId, host) => {
    if (!isMerchantId(siteId)) {
      throw new SiteApiError("NOT_FOUND", "Invalid site ID", 404);
    }
    // Input preparation has already validated the fixed build document once.
    if (isBuilding()) return readSnapshot(templateId, siteId);
    const hostname = normalizeHostname(host);
    if (!hostname) throw new SiteApiError("IDENTITY_MISMATCH", "A request hostname is required for public content");
    const identity = await resolve(hostname);
    if (!identity) throw new SiteApiError("NOT_FOUND", "Site is no longer public", 404);
    if (identity.merchantId !== siteId || identity.siteId !== siteId || identity.templateId !== templateId ||
        normalizeHostname(new URL(identity.siteUrl).hostname) !== hostname) {
      throw new SiteApiError("IDENTITY_MISMATCH", `Public request identity mismatch: ${siteId}`);
    }
    const result = await readPublic(siteId, { templateId: identity.templateId, siteUrl: identity.siteUrl });
    if (result.merchantId !== siteId || result.templateId !== identity.templateId || result.siteUrl !== identity.siteUrl) {
      throw new SiteApiError("IDENTITY_MISMATCH", `Public document canonical identity mismatch: ${siteId}`);
    }
    if (!result.document || typeof result.document !== "object" || Array.isArray(result.document)) {
      throw new SiteApiError("INVALID_RESPONSE", "Expected public document object");
    }
    let normalized;
    try { normalized = normalizeMerchantDocument({ merchantId: siteId, document: result.document }); }
    catch { throw new SiteApiError("IDENTITY_MISMATCH", `Public document identity mismatch: ${siteId}`); }
    const document = validate(normalized);
    if (document.siteUrl !== identity.siteUrl) {
      throw new SiteApiError("IDENTITY_MISMATCH", `Public document canonical identity mismatch: ${siteId}`);
    }
    return document;
  };
}
