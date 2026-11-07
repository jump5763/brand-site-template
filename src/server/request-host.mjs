import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external.js";
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external.js";
import nextPackage from "next/package.json" with { type: "json" };
import { SiteApiError } from "./site-api.mjs";

/** Read only the pinned runtime's real request, bypassing force-static's empty public headers. */
export function readRequestHost() {
  if (nextPackage.version !== "16.3.3") {
    throw new SiteApiError("UNAVAILABLE", "Request identity adapter requires verification for this Next version", 503);
  }
  const store = workUnitAsyncStorage.getStore();
  const work = workAsyncStorage.getStore();
  // Cold static regeneration replaces the request unit, but retains its own incremental cache.
  const host = store?.type === "request" ? store.headers?.get("host")
    : store?.type === "prerender-legacy" && work && !work.isBuildTimePrerendering && process.env.NEXT_RUNTIME !== "edge"
      ? work.incrementalCache?.requestHeaders?.host : null;
  if (typeof host !== "string" || !host) throw new SiteApiError("UNAVAILABLE", "Trusted request Host is unavailable", 503);
  return host;
}
