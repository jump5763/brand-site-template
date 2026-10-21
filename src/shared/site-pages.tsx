import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { jsonLdProps } from "./json-ld";

type PageDocument = {
  siteUrl: string;
  pages: Array<{
    path: string;
    metadata: {
      title: string;
      description: string;
      robots?: { index?: boolean; follow?: boolean };
      openGraph?: unknown;
      structuredData?: unknown;
    };
  }>;
};
export type SiteParams = { siteId: string; slug?: string[] };
export type SitePageProps = { params: Promise<SiteParams> };
export const pagePath = (slug: string[] = []) => `/${slug.join("/")}`;

export function pageParams(site: PageDocument) {
  return site.pages.map((page) => ({ slug: page.path.split("/").filter(Boolean) }));
}

export function pageMetadata(site: PageDocument, path: string): Metadata {
  const page = site.pages.find((entry) => entry.path === path);
  if (!page) notFound();
  return {
    title: page.metadata.title,
    description: page.metadata.description,
    alternates: { canonical: new URL(page.path, site.siteUrl).toString() },
    robots: process.env.SEARCH_INDEXING_ENABLED === "true" ? page.metadata.robots : { index: false, follow: false },
    ...(page.metadata.openGraph ? { openGraph: page.metadata.openGraph as Metadata["openGraph"] } : {}),
  };
}

export function renderContent<T extends PageDocument>(site: T, path: string, render: (site: T, path: string) => ReactNode) {
  const page = site.pages.find((entry) => entry.path === path);
  if (!page) notFound();
  return <>{page.metadata.structuredData ? <script {...jsonLdProps(page.metadata.structuredData)} /> : null}{render(site, path)}</>;
}

const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
export function sitemapResponse(site: PageDocument) {
  const pages = process.env.SEARCH_INDEXING_ENABLED === "true" ? site.pages.filter((page) => page.metadata.robots?.index !== false) : [];
  const urls = pages.map((page) => `<url><loc>${escapeXml(new URL(page.path, site.siteUrl).toString())}</loc></url>`).join("");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}

export function robotsResponse(site: PageDocument) {
  const body = process.env.SEARCH_INDEXING_ENABLED === "true" ? `User-agent: *\nAllow: /\nSitemap: ${new URL("/sitemap.xml", site.siteUrl)}\n` : "User-agent: *\nDisallow: /\n";
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
