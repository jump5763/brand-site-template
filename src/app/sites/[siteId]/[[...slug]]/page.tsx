import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadSite } from "@/load-site";
import { renderSitePage } from "@/template-map";
import { jsonLdProps } from "@/templates/a/site-schema/runtime/json-ld";

type Params = { siteId: string; slug?: string[] };
type Props = { params: Promise<Params> };
const pagePath = (slug: string[] = []) => `/${slug.join("/")}`;

export const dynamic = "error";
export const dynamicParams = false;

export async function generateStaticParams({ params }: { params: { siteId: string } }) {
  const { site } = await loadSite(params.siteId);
  return site.pages.map((page) => ({ slug: page.path.split("/").filter(Boolean) }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { siteId, slug } = await params;
  const { site } = await loadSite(siteId);
  const page = site.pages.find((entry) => entry.path === pagePath(slug));
  if (!page) notFound();
  return {
    title: page.metadata.title,
    description: page.metadata.description,
    alternates: { canonical: new URL(page.path, site.siteUrl).toString() },
    robots: process.env.SEARCH_INDEXING_ENABLED === "true" ? page.metadata.robots : { index: false, follow: false },
    ...(page.metadata.openGraph ? { openGraph: page.metadata.openGraph as Metadata["openGraph"] } : {}),
  };
}

export default async function SitePage({ params }: Props) {
  const { siteId, slug } = await params;
  const loaded = await loadSite(siteId);
  const path = pagePath(slug);
  const page = loaded.site.pages.find((entry) => entry.path === path);
  if (!page) notFound();
  return (
    <>
      {page.metadata.structuredData ? <script {...jsonLdProps(page.metadata.structuredData)} /> : null}
      {renderSitePage(loaded, path)}
    </>
  );
}
