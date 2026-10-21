import type { ReactNode } from "react";
import type { SiteDocument as SiteA } from "@/templates/a/site-schema/generated/types";
import type { SiteDocument as SiteB } from "@/templates/b/site-schema/generated/types";
import { assertValidSiteDocument as validateA } from "@/templates/a/site-schema/runtime/validator.mjs";
import { assertValidSiteDocument as validateB } from "@/templates/b/site-schema/runtime/validator.mjs";
import { renderPage as renderA } from "@/templates/a/site-schema/runtime/render-page";
import { renderPage as renderB } from "@/templates/b/site-schema/runtime/render-page";
import { SiteLayout as LayoutA } from "@/templates/a/site-schema/runtime/render-layout";
import { SiteLayout as LayoutB } from "@/templates/b/site-schema/runtime/render-layout";
import { themeToCssVariables as themeA } from "@/templates/a/site-schema/runtime/apply-theme";
import { themeToCssVariables as themeB } from "@/templates/b/site-schema/runtime/apply-theme";
import { Toaster } from "@/templates/a/components/ui/sonner";

export const templateMap = {
  a: { validate: validateA, renderPage: renderA, Layout: LayoutA, theme: themeA },
  b: { validate: validateB, renderPage: renderB, Layout: LayoutB, theme: themeB },
} as const;

export type LoadedSite =
  | { templateId: "a"; site: SiteA }
  | { templateId: "b"; site: SiteB };

export function renderSitePage(loaded: LoadedSite, path: string) {
  return loaded.templateId === "a"
    ? templateMap.a.renderPage(loaded.site, path)
    : templateMap.b.renderPage(loaded.site, path);
}

export function siteTheme(loaded: LoadedSite) {
  return loaded.templateId === "a"
    ? templateMap.a.theme(loaded.site.theme)
    : templateMap.b.theme(loaded.site.theme);
}

export function TemplateLayout({ loaded, children }: { loaded: LoadedSite; children: ReactNode }) {
  if (loaded.templateId === "a") {
    return (
      <>
        <LayoutA site={loaded.site}>{children}</LayoutA>
        <Toaster theme="light" position="top-center" />
      </>
    );
  }
  return <LayoutB site={loaded.site}>{children}</LayoutB>;
}
