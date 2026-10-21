import { loadSite } from "@/load-site";
import { getBuildSites } from "@/site-routing.mjs";

export const dynamic = "force-static";
export const dynamicParams = false;
export function generateStaticParams() {
  return getBuildSites().map((site) => ({ siteId: site.id }));
}
const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export async function GET(_request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const { site } = await loadSite((await params).siteId);
  const pages = process.env.SEARCH_INDEXING_ENABLED === "true"
    ? site.pages.filter((page) => page.metadata.robots?.index !== false)
    : [];
  const urls = pages.map((page) => `<url><loc>${escapeXml(new URL(page.path, site.siteUrl).toString())}</loc></url>`).join("");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}
