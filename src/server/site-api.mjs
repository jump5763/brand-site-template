import http from "node:http";
import https from "node:https";
import { isMerchantId, normalizeMerchantDocument } from "./site-input.mjs";

const safeId = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

export class SiteApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "SiteApiError";
    this.code = code;
    this.status = status;
  }
}

function statusError(status) {
  const code = status === 404 || status === 410 ? "NOT_FOUND"
    : status === 401 || status === 403 ? "UNAUTHORIZED" : "UNAVAILABLE";
  return new SiteApiError(code, `Public content API: HTTP ${status}`, status);
}

// Native transport leaves page caching to Next, without a fetch cache policy.
function requestNativeJson(url, { token, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.get(url, {
      headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }, (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(statusError(response.statusCode));
        return;
      }
      if (!response.headers["content-type"]?.toLowerCase().includes("application/json")) {
        response.resume();
        reject(new SiteApiError("INVALID_RESPONSE", "Public content API: expected JSON"));
        return;
      }
      const chunks = [];
      let length = 0;
      response.on("data", (chunk) => {
        length += chunk.length;
        if (length > 10 * 1024 * 1024) {
          request.destroy(new SiteApiError("INVALID_RESPONSE", "Public content API: response too large"));
        } else chunks.push(chunk);
      });
      response.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { reject(new SiteApiError("INVALID_RESPONSE", "Public content API: invalid JSON")); }
      });
      response.on("error", () => reject(new SiteApiError("UNAVAILABLE", "Public content API: interrupted response")));
    });
    const timer = setTimeout(() => request.destroy(new SiteApiError("UNAVAILABLE", "Public content API: request timed out")), timeoutMs);
    request.once("close", () => clearTimeout(timer));
    request.once("error", (error) => reject(error instanceof SiteApiError ? error
      : new SiteApiError("UNAVAILABLE", "Public content API: request failed")));
  });
}

function identity(value) {
  if (!value || !isMerchantId(value.merchantId) || typeof value.templateId !== "string" || !safeId.test(value.templateId)) {
    throw new SiteApiError("INVALID_RESPONSE", "Public content API: invalid merchant identity");
  }
  let url;
  try { url = new URL(value.siteUrl); } catch { /* Report a stable public error below. */ }
  if (!url || !["https:", "http:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new SiteApiError("INVALID_RESPONSE", "Public content API: invalid canonical URL");
  }
  return { merchantId: value.merchantId, siteId: value.merchantId, templateId: value.templateId, siteUrl: value.siteUrl };
}

export function createSiteApi({
  baseUrl = process.env.CONTENT_API_URL,
  token = process.env.CONTENT_API_TOKEN,
  timeoutMs = 30_000,
  requestJson = requestNativeJson,
} = {}) {
  async function read(endpoint) {
    let base;
    try { base = new URL(baseUrl); } catch { /* Validate before issuing a request. */ }
    if (!base || !["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
      throw new SiteApiError("CONFIG", "CONTENT_API_URL must be an HTTP(S) API URL");
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new SiteApiError("CONFIG", "Invalid content API timeout");
    return requestJson(new URL(`${base.href.replace(/\/$/, "")}${endpoint}`), { token, timeoutMs });
  }

  return {
    async resolveMerchant(hostname) {
      let value;
      try { value = await read(`/sites/resolve?hostname=${encodeURIComponent(hostname)}`); }
      catch (error) { if (error.code === "NOT_FOUND") return null; throw error; }
      if (value?.public === false) return null;
      if (value?.public !== true) throw new SiteApiError("INVALID_RESPONSE", "Public content API: public status is required");
      const merchant = identity(value);
      if (new URL(merchant.siteUrl).hostname.toLowerCase().replace(/\.$/, "") !== hostname) {
        throw new SiteApiError("IDENTITY_MISMATCH", "Public content API: hostname identity mismatch");
      }
      return merchant;
    },

    async readPublicDocument(siteId, expected = {}) {
      if (!isMerchantId(siteId)) throw new SiteApiError("IDENTITY_MISMATCH", "Invalid requested site ID");
      const value = await read(`/sites/${encodeURIComponent(siteId)}/content`);
      if (value?.public === false) throw new SiteApiError("NOT_FOUND", "Site is not public", 404);
      if (value?.public !== true) throw new SiteApiError("INVALID_RESPONSE", "Public content API: public status is required");
      const merchant = identity(value);
      if (merchant.siteId !== siteId) throw new SiteApiError("IDENTITY_MISMATCH", "Public content API: document identity mismatch");
      if ((expected.templateId !== undefined && merchant.templateId !== expected.templateId) ||
          (expected.siteUrl !== undefined && merchant.siteUrl !== expected.siteUrl)) {
        throw new SiteApiError("IDENTITY_MISMATCH", "Public content API: requested binding mismatch");
      }
      if (!value.document || typeof value.document !== "object" || Array.isArray(value.document)) {
        throw new SiteApiError("INVALID_RESPONSE", "Public content API: expected document object");
      }
      let document;
      try { document = normalizeMerchantDocument({ merchantId: merchant.merchantId, document: value.document }); }
      catch { throw new SiteApiError("IDENTITY_MISMATCH", "Public content API: document identity mismatch"); }
      if (document.siteUrl !== merchant.siteUrl) throw new SiteApiError("IDENTITY_MISMATCH", "Public content API: canonical URL mismatch");
      return { merchantId: merchant.merchantId, templateId: merchant.templateId, siteUrl: merchant.siteUrl, document };
    },

    async readDraftDocument(merchantId, templateId) {
      if (!isMerchantId(merchantId) || typeof templateId !== "string" || !safeId.test(templateId)) {
        throw new SiteApiError("IDENTITY_MISMATCH", "Invalid requested draft identity");
      }
      const value = await read(`/brand-site/${encodeURIComponent(merchantId)}/drafts/${encodeURIComponent(templateId)}`);
      const merchant = identity(value);
      if (merchant.merchantId !== merchantId || merchant.templateId !== templateId) {
        throw new SiteApiError("IDENTITY_MISMATCH", "Draft API: response identity mismatch");
      }
      if (typeof value.site !== "string" || typeof value.contentRevision !== "string" || !value.contentRevision) {
        throw new SiteApiError("INVALID_RESPONSE", "Draft API: content and revision are required");
      }
      let document;
      try { document = JSON.parse(value.site); }
      catch { throw new SiteApiError("INVALID_RESPONSE", "Draft API: invalid content JSON"); }
      if (!document || typeof document !== "object" || Array.isArray(document)) {
        throw new SiteApiError("INVALID_RESPONSE", "Draft API: expected document object");
      }
      try { document = normalizeMerchantDocument({ merchantId, document }); }
      catch { throw new SiteApiError("IDENTITY_MISMATCH", "Draft API: document identity mismatch"); }
      if (document.siteUrl !== merchant.siteUrl) throw new SiteApiError("IDENTITY_MISMATCH", "Draft API: canonical URL mismatch");
      return { merchantId, templateId, siteUrl: merchant.siteUrl, contentRevision: value.contentRevision, document };
    },

    async listPublicSites(scope = { scope: "all" }) {
      let query = "";
      if (scope.scope === "site" && isMerchantId(scope.siteId)) query = `?merchantId=${encodeURIComponent(scope.siteId)}`;
      else if (scope.scope === "template" && typeof scope.templateId === "string" && safeId.test(scope.templateId)) query = `?templateId=${encodeURIComponent(scope.templateId)}`;
      else if (scope.scope !== "all") throw new SiteApiError("CONFIG", "Invalid publication scope");
      const value = await read(`/sites${query}`);
      if (!Array.isArray(value?.sites)) throw new SiteApiError("INVALID_RESPONSE", "Public content API: expected sites array");
      return value.sites.map((site) => {
        if (site.public !== true) throw new SiteApiError("INVALID_RESPONSE", "Public content API: scope contains a non-public site");
        return identity(site);
      });
    },
  };
}

export const resolveMerchant = (hostname) => createSiteApi().resolveMerchant(hostname);
export const readPublicDocument = (siteId, expected) => createSiteApi().readPublicDocument(siteId, expected);
export const listPublicSites = (scope) => createSiteApi().listPublicSites(scope);

export const readDraftDocument = (merchantId, templateId) => createSiteApi().readDraftDocument(merchantId, templateId);
