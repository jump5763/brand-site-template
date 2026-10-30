import { NextRequest, NextResponse } from "next/server";
import { normalizeHostname, resolveSiteRequest, resolvePreviewRequest } from "./site-routing.mjs";
import { resolveSite } from "./server/resolve-site.mjs";

export async function proxy(request: NextRequest) {
  const host = request.headers.get("host") || "";
  const pathname = request.nextUrl.pathname;
  const hostname = normalizeHostname(host);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  const headers = { "Cache-Control": "no-store" };
  if (pathname === "/healthz") return NextResponse.next({ headers });
  if (local && pathname === "/") return NextResponse.next({ headers });
  try {
    const previewDomain = process.env.PREVIEW_BASE_DOMAIN || "preview.localhost";
    if (hostname.endsWith(`.${previewDomain}`)) {
      const resolved = resolvePreviewRequest(host, pathname, previewDomain);
      if (!resolved) return new NextResponse("Not found", { status: 404, headers });
      if (resolved.pathname === pathname) return NextResponse.next({ headers });
      const destination = request.nextUrl.clone();
      destination.pathname = resolved.pathname;
      return NextResponse.rewrite(destination, { headers });
    }
    const identity = await resolveSite(host);
    const resolved = identity ? resolveSiteRequest(identity, pathname) : null;
    if (!resolved) return new NextResponse("Not found", { status: 404, headers });
    if (resolved.pathname === pathname) return NextResponse.next({ headers });
    const destination = request.nextUrl.clone();
    destination.pathname = resolved.pathname;
    return NextResponse.rewrite(destination, { headers });
  } catch (error) {
    console.error("Merchant resolution failed:", error instanceof Error ? error.message : "Unknown error");
    return new NextResponse("Service unavailable", { status: 503, headers });
  }
}

export const config = {
  matcher: ["/((?!_next/|media/).*)"],
};
