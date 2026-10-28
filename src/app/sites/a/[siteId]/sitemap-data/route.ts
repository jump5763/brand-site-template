import { loadSite } from "@/templates/a/site";
import { sitesForTemplate } from "@/server/build-input.mjs";
import { sitemapResponse } from "@/shared/site-pages";

export const dynamic = "force-static";
export const dynamicParams = true;
export function generateStaticParams() {
  return sitesForTemplate("a").map((site) => ({ siteId: site.id }));
}
export async function GET(_request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  return sitemapResponse(await loadSite((await params).siteId));
}
