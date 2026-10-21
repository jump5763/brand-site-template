import { loadSite } from "@/templates/a/site";
import { sitesForTemplate } from "@/site-routing.mjs";
import { robotsResponse } from "@/shared/site-pages";

export const dynamic = "force-static";
export const dynamicParams = false;
export function generateStaticParams() {
  return sitesForTemplate("a").map((site) => ({ siteId: site.id }));
}
export async function GET(_request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  return robotsResponse(await loadSite((await params).siteId));
}
