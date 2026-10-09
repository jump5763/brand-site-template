import { jsonLdProps } from "@/site-schema/runtime/json-ld";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadSiteSchema } from "@/site-schema/runtime/load-site";
import { generatePageMetadata } from "@/site-schema/runtime/generate-page-metadata";
import { renderPage, resolvePage } from "@/site-schema/runtime/render-page";

interface RouteProps {
  params: Promise<{ slug?: string[] }>;
}

function pathFromSlug(slug?: string[]) {
  return slug && slug.length > 0 ? `/${slug.join("/")}` : "/";
}

export async function generateStaticParams() {
  const site = await loadSiteSchema();
  return (site.pages as Array<{ path: string }>).map((page) => ({
    slug: page.path === "/" ? [] : page.path.split("/").filter(Boolean),
  }));
}

export async function generateMetadata({
  params,
}: RouteProps): Promise<Metadata> {
  const site = await loadSiteSchema();
  const path = pathFromSlug((await params).slug);
  try {
    return generatePageMetadata(site, path);
  } catch {
    return {};
  }
}

export default async function ContentPage({ params }: RouteProps) {
  const site = await loadSiteSchema();
  const path = pathFromSlug((await params).slug);
  try {
    resolvePage(site, path);
  } catch {
    notFound();
  }
  const page = resolvePage(site, path);
  return (
    <>
      {page.metadata.structuredData ? (
        <script {...jsonLdProps(page.metadata.structuredData)} />
      ) : null}
      {renderPage(site, path)}
    </>
  );
}
