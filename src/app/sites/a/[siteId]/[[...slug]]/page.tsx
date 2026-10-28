import { loadSite } from "@/templates/a/site";
import { renderPage } from "@/templates/a/site-schema/runtime/render-page";
import { pageParams, pageMetadata, pagePath, renderContent, type SitePageProps } from "@/shared/site-pages";

export const dynamic = "force-static";
export const dynamicParams = true;
export async function generateStaticParams({ params }: { params: { siteId: string } }) {
  if (!params.siteId) return [];
  return pageParams(await loadSite(params.siteId));
}
export async function generateMetadata({ params }: SitePageProps) {
  const { siteId, slug } = await params;
  return pageMetadata(await loadSite(siteId), pagePath(slug));
}
export default async function Page({ params }: SitePageProps) {
  const { siteId, slug } = await params;
  return renderContent(await loadSite(siteId), pagePath(slug), renderPage);
}
