import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const identity = JSON.parse(await readFile(path.join(process.cwd(), "runtime.json"), "utf8"));
    if (typeof identity.runtimeId !== "string" || !identity.runtimeId || identity.runtimeId !== process.env.RUNTIME_ID) {
      return Response.json({ status: "error", error: "Runtime identity mismatch" }, { status: 503 });
    }
    return Response.json({ status: "ok", runtimeId: identity.runtimeId }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "error", error: "Runtime identity unavailable" }, { status: 503 });
  }
}
