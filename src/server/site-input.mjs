import path from "node:path";
import { pathToFileURL } from "node:url";

const safeId = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const siteUrlKeys = new Set(["url", "hasMenu", "@id", "mainEntityOfPage"]);

export class SiteInputError extends Error {
  constructor(diagnostics, { status = 422, code = "SITE_INPUT_INVALID", cause } = {}) {
    super(diagnostics.map(({ message }) => message).join("; "), { cause });
    this.name = "SiteInputError";
    this.code = code;
    this.status = status;
    this.diagnostics = diagnostics;
  }
}

function invalid(ruleId, pointer, message) {
  return new SiteInputError([{ ruleId, pointer, message }]);
}

function canonicalSiteUrl(value) {
  let url;
  try { url = new URL(value); } catch { /* Report one stable input diagnostic. */ }
  if (typeof value !== "string" || !url || !["http:", "https:"].includes(url.protocol) ||
    url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw invalid("SITE_URL_INVALID", "/siteUrl", "Site URL must be an HTTP(S) origin without credentials, path, query or fragment");
  }
  return url.origin;
}

function checkSiteId(siteId) {
  if (typeof siteId !== "string" || !safeId.test(siteId)) {
    throw invalid("SITE_ID_INVALID", "/siteId", "Site ID must contain only letters, digits, underscores and hyphens");
  }
}

export async function validateSiteInput({ sourceRoot, templateId, document, identity }) {
  if (typeof templateId !== "string" || !safeId.test(templateId)) {
    throw invalid("TEMPLATE_ID_INVALID", "/templateId", "Template ID is invalid");
  }
  if (identity?.templateId !== undefined && identity.templateId !== templateId) {
    throw invalid("TEMPLATE_ID_MISMATCH", "/templateId", "Template does not match the site's binding");
  }
  checkSiteId(identity?.siteId);
  const expectedSiteUrl = canonicalSiteUrl(identity?.siteUrl);

  let assertValidSiteDocument;
  try {
    if (typeof sourceRoot !== "string" || !path.isAbsolute(sourceRoot)) {
      throw new Error("sourceRoot must be an absolute installed source path");
    }
    const validatorUrl = pathToFileURL(path.join(sourceRoot, "src/templates", templateId, "site-schema/runtime/validator.mjs"));
    ({ assertValidSiteDocument } = await import(validatorUrl.href));
    if (typeof assertValidSiteDocument !== "function") throw new Error("Template validator export is missing");
  } catch (cause) {
    throw new SiteInputError([
      { ruleId: "SITE_VALIDATOR_UNAVAILABLE", pointer: "/", message: `Installed validator is unavailable for ${templateId}` },
    ], { code: "SITE_VALIDATOR_UNAVAILABLE", status: 503, cause });
  }

  let value;
  try { value = assertValidSiteDocument(document); }
  catch (cause) {
    if (!Array.isArray(cause.diagnostics)) throw cause;
    throw new SiteInputError(cause.diagnostics, { cause });
  }
  // These public paths belong to the host, not to template content pages.
  const reservedPrefixes = ["/sites", "/preview", "/media"];
  const reservedPaths = ["/healthz", "/robots.txt", "/sitemap.xml", "/sitemap-data"];
  const reserved = value.pages.flatMap((page, index) => {
    let pathname;
    try { pathname = decodeURIComponent(page.path); }
    catch { return [{ ruleId: "PAGE_PATH_INVALID", pointer: `/pages/${index}/path`, message: "Page path has invalid URL encoding" }]; }
    return reservedPaths.includes(pathname) || reservedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
      ? [{ ruleId: "PAGE_PATH_RESERVED", pointer: `/pages/${index}/path`, message: "Page path is reserved by the site runtime" }] : [];
  });
  if (reserved.length) throw new SiteInputError(reserved);
  if (value.siteId !== identity.siteId) {
    throw invalid("SITE_ID_MISMATCH", "/siteId", "Document site ID does not match the site's identity");
  }
  const siteUrl = canonicalSiteUrl(value.siteUrl);
  if (siteUrl !== expectedSiteUrl) {
    throw invalid("SITE_URL_MISMATCH", "/siteUrl", "Document site URL does not match the site's identity");
  }
  return value.siteUrl === siteUrl ? value : { ...value, siteUrl };
}

export function instantiateSiteDefaults(defaultDocument, { siteId, siteUrl }) {
  checkSiteId(siteId);
  const previousOrigin = canonicalSiteUrl(defaultDocument.siteUrl);
  const nextOrigin = canonicalSiteUrl(siteUrl);
  const document = structuredClone(defaultDocument);
  document.siteId = siteId;
  document.siteUrl = nextOrigin;

  const replaceOrigin = (value) => {
    if (typeof value !== "string" || !/^https?:\/\//i.test(value)) return value;
    let url;
    try { url = new URL(value); } catch { return value; }
    if (url.origin !== previousOrigin) return value;
    return nextOrigin + url.pathname + url.search + url.hash;
  };
  const visitStructuredData = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visitStructuredData);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (siteUrlKeys.has(key) && typeof value === "string") node[key] = replaceOrigin(value);
      else visitStructuredData(value);
    }
  };
  for (const page of document.pages ?? []) {
    visitStructuredData(page.metadata?.structuredData);
    if (page.metadata?.openGraph?.url !== undefined) {
      page.metadata.openGraph.url = replaceOrigin(page.metadata.openGraph.url);
    }
  }
  return document;
}
