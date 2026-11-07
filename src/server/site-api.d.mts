export interface MerchantIdentity {
  merchantId: string;
  siteId: string;
  templateId: string;
  siteUrl: string;
}
export type PublicationScope = { scope: "all" } | { scope: "template"; templateId: string } | { scope: "site"; siteId: string };
export interface PublicDocument {
  merchantId: string;
  siteUrl: string;
  templateId: string;
  document: { siteId: string; siteUrl: string; [key: string]: unknown };
}
export class SiteApiError extends Error {
  code: "CONFIG" | "UNAVAILABLE" | "UNAUTHORIZED" | "INVALID_RESPONSE" | "IDENTITY_MISMATCH" | "NOT_FOUND";
  status?: number;
  constructor(code: SiteApiError["code"], message: string, status?: number);
}
export interface DraftDocument extends PublicDocument {
  contentRevision: string;
}
export interface SiteApi {
  readDraftDocument(merchantId: string, templateId: string): Promise<DraftDocument>;
  resolveMerchant(hostname: string): Promise<MerchantIdentity | null>;
  readPublicDocument(siteId: string, expected?: { templateId?: string; siteUrl?: string }): Promise<PublicDocument>;
  listPublicSites(scope?: PublicationScope): Promise<MerchantIdentity[]>;
}
export function createSiteApi(options?: {
  baseUrl?: string;
  token?: string;
  timeoutMs?: number;
  requestJson?: (url: URL, options: { token?: string; timeoutMs: number }) => Promise<unknown>;
}): SiteApi;
export const resolveMerchant: SiteApi["resolveMerchant"];
export const readPublicDocument: SiteApi["readPublicDocument"];
export const listPublicSites: SiteApi["listPublicSites"];

export const readDraftDocument: SiteApi["readDraftDocument"];
