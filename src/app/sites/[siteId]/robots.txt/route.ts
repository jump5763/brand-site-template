import { loadSite } from "@/load-site";
import { getBuildSites } from "@/site-routing.mjs";

export const dynamic = "force-static";
export const dynamicParams = false;
export function generateStaticParams() {
  return getBuildSites().map((site) => ({ siteId: site.id }));
}
export async function GET(_request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const { site } = await loadSite((await params).siteId);
  const body = process.env.SEARCH_INDEXING_ENABLED === "true"
    ? `User-agent: *\nAllow: /\nSitemap: ${new URL("/sitemap.xml", site.siteUrl)}\n`
    : "User-agent: *\nDisallow: /\n";
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
