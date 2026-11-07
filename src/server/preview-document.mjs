import { resolvePreviewRequest } from "../site-routing.mjs";
import { readPreviewDocument } from "./build-input.mjs";
import { readDraftDocument, SiteApiError } from "./site-api.mjs";

/** This reader has no cross-request cache; its wrapper shares reads within a render only. */
export function createPreviewDocumentReader({ templateId, validate, readDraft = readDraftDocument,
  readDemo = readPreviewDocument, resolvePreview = resolvePreviewRequest,
  baseDomain = process.env.PREVIEW_BASE_DOMAIN || "preview.localhost" }) {
  return async (host) => {
    const identity = resolvePreview(host, "/", baseDomain);
    if (!identity || identity.templateId !== templateId) {
      throw new SiteApiError("IDENTITY_MISMATCH", "Preview Host does not match the route template");
    }
    if (!identity.merchantId) return validate(await readDemo(templateId));
    const result = await readDraft(identity.merchantId, templateId);
    if (result.merchantId !== identity.merchantId || result.templateId !== templateId ||
        result.document.siteId !== identity.merchantId || result.document.siteUrl !== result.siteUrl) {
      throw new SiteApiError("IDENTITY_MISMATCH", "Preview candidate identity mismatch");
    }
    return validate(result.document);
  };
}
