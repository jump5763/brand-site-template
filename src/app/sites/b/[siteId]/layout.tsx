import type { ReactNode } from "react";
import { loadSite } from "@/templates/b/site";
import { SiteLayout } from "@/templates/b/site-schema/runtime/render-layout";
import { themeToCssVariables } from "@/templates/b/site-schema/runtime/apply-theme";
import { sitesForTemplate } from "@/site-routing.mjs";
import "@/templates/b/styles.css";
import "@/styles/base.css";

export const dynamic = "error";
export const dynamicParams = false;
export function generateStaticParams() {
  return sitesForTemplate("b").map((site) => ({ siteId: site.id }));
}
export default async function Layout({ children, params }: { children: ReactNode; params: Promise<{ siteId: string }> }) {
  const site = await loadSite((await params).siteId);
  return (
    <html lang="en" data-template="b">
      <body data-site-id={site.siteId} style={themeToCssVariables(site.theme)} className="bg-background font-sans text-foreground antialiased">
        <SiteLayout site={site}>{children}</SiteLayout>
        
      </body>
    </html>
  );
}
