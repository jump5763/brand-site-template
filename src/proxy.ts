import { NextRequest, NextResponse } from "next/server";
import { normalizeHostname, resolveSiteRequest } from "./site-routing.mjs";

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") || "";
  const pathname = request.nextUrl.pathname;
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(normalizeHostname(host));
  if (local && pathname === "/") return NextResponse.next();
  const resolved = resolveSiteRequest(host, pathname);
  if (!resolved) return new NextResponse("Not found", { status: 404 });
  if (resolved.pathname === pathname) return NextResponse.next();
  const destination = request.nextUrl.clone();
  destination.pathname = resolved.pathname;
  return NextResponse.rewrite(destination);
}

export const config = {
  matcher: ["/((?!_next/|media/).*)"],
};
