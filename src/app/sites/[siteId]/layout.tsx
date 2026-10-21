import type { ReactNode } from "react";
import { loadSite } from "@/load-site";
import { getBuildSites } from "@/site-routing.mjs";
import { siteTheme, TemplateLayout } from "@/template-map";
import "@/styles/globals.css";

export const dynamic = "error";
export const dynamicParams = false;

export function generateStaticParams() {
  return getBuildSites().map((site) => ({ siteId: site.id }));
}

export default async function SiteRootLayout({ children, params }: {
  children: ReactNode;
  params: Promise<{ siteId: string }>;
}) {
  const loaded = await loadSite((await params).siteId);
  return (
    <html lang="en" data-template={loaded.templateId}>
      <body data-site-id={loaded.site.siteId} style={siteTheme(loaded)} className="bg-background font-sans text-foreground antialiased">
        <TemplateLayout loaded={loaded}>{children}</TemplateLayout>
      </body>
    </html>
  );
}
