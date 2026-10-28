import type { ReactNode } from "react";
import { loadSite } from "@/templates/a/site";
import { SiteLayout } from "@/templates/a/site-schema/runtime/render-layout";
import { themeToCssVariables } from "@/templates/a/site-schema/runtime/apply-theme";
import { sitesForTemplate } from "@/server/build-input.mjs";
import { Toaster } from "@/templates/a/components/ui/sonner";
import "@/templates/a/styles.css";
import "@/styles/base.css";

export const dynamic = "force-static";
export const dynamicParams = true;
export function generateStaticParams() {
  return sitesForTemplate("a").map((site) => ({ siteId: site.id }));
}
export default async function Layout({ children, params }: { children: ReactNode; params: Promise<{ siteId: string }> }) {
  const site = await loadSite((await params).siteId);
  return (
    <html lang="en" data-template="a">
      <body data-site-id={site.siteId} style={themeToCssVariables(site.theme)} className="bg-background font-sans text-foreground antialiased">
        <SiteLayout site={site}>{children}</SiteLayout>
        <Toaster theme="light" position="top-center" />
      </body>
    </html>
  );
}
