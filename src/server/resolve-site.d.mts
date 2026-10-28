import type { MerchantIdentity } from "./site-api.mjs";

export type SiteResolver = (host: string) => Promise<MerchantIdentity | null>;
export function createSiteResolver(options?: {
  lookup?: (hostname: string) => Promise<MerchantIdentity | null>;
  now?: () => number;
  positiveTtlMs?: number;
  negativeTtlMs?: number;
  capacity?: number;
  installedTemplates?: string[];
}): SiteResolver;
export const resolveSite: SiteResolver;
