import { NextRequest, NextResponse } from "next/server";
import { normalizeHostname, resolveSiteRequest } from "./site-routing.mjs";
import { resolveSite } from "./server/resolve-site.mjs";

export async function proxy(request: NextRequest) {
  const host = request.headers.get("host") || "";
  const pathname = request.nextUrl.pathname;
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(normalizeHostname(host));
  const headers = { "Cache-Control": "no-store" };
  if (local && pathname === "/") return NextResponse.next({ headers });
  try {
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
