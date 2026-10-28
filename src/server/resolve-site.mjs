import templateIds from "../template-ids.json" with { type: "json" };
import { normalizeHostname } from "../site-routing.mjs";
import { resolveMerchant } from "./site-api.mjs";

/** Cache only confirmed identities or explicit business absence. */
export function createSiteResolver({
  lookup = resolveMerchant,
  now = Date.now,
  positiveTtlMs = 30_000,
  negativeTtlMs = 5_000,
  capacity = 2_000,
  installedTemplates = templateIds,
} = {}) {
  if (![positiveTtlMs, negativeTtlMs].every((value) => Number.isFinite(value) && value >= 0) ||
      !Number.isSafeInteger(capacity) || capacity < 1) {
    throw new Error("Invalid merchant resolution cache configuration");
  }
  const cache = new Map();
  const inFlight = new Map();
  const installed = new Set(installedTemplates);

  return function resolveSite(host) {
    const hostname = normalizeHostname(host);
    if (!hostname) return Promise.resolve(null);
    const entry = cache.get(hostname);
    if (entry && entry.expiresAt > now()) {
      cache.delete(hostname);
      cache.set(hostname, entry);
      return Promise.resolve(entry.value);
    }
    cache.delete(hostname);
    if (inFlight.has(hostname)) return inFlight.get(hostname);

    const pending = Promise.resolve().then(() => lookup(hostname)).then((value) => {
      if (value !== null && !installed.has(value.templateId)) {
        throw new Error(`Template is not installed: ${value.templateId}`);
      }
      const ttl = value === null ? negativeTtlMs : positiveTtlMs;
      if (ttl > 0) {
        cache.set(hostname, { value, expiresAt: now() + ttl });
        while (cache.size > capacity) cache.delete(cache.keys().next().value);
      }
      return value;
    }).finally(() => inFlight.delete(hostname));
    inFlight.set(hostname, pending);
    return pending;
  };
}

let resolver;

/** Read server-only settings when the first request arrives. */
export function resolveSite(host) {
  resolver ??= createSiteResolver({
    positiveTtlMs: Number(process.env.SITE_RESOLVE_TTL_MS ?? 30_000),
    negativeTtlMs: Number(process.env.SITE_RESOLVE_NEGATIVE_TTL_MS ?? 5_000),
    capacity: Number(process.env.SITE_RESOLVE_CACHE_CAPACITY ?? 2_000),
  });
  return resolver(host);
}
