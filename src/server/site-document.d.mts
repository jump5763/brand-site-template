import type { PublicDocument, MerchantIdentity } from "./site-api.mjs";
export function createSiteDocumentReader<T extends { siteId: string; siteUrl: string }>(options: {
  templateId: string;
  validate: (value: unknown) => T;
  isBuilding?: () => boolean;
  readSnapshot?: (templateId: string, siteId: string) => Promise<unknown>;
  readPublic?: (siteId: string) => Promise<PublicDocument>;
  resolve?: (hostname: string) => Promise<MerchantIdentity | null>;
}): (siteId: string) => Promise<T>;
