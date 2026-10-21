import React from "react";
import type { SiteDocument } from "./load-site";
import { renderSection } from "../generated";

export function resolvePage(site: SiteDocument, pathOrId: string) {
  const page = site.pages.find(
    (candidate) => candidate.id === pathOrId || candidate.path === pathOrId,
  );
  if (!page) throw new Error(`PAGE_UNKNOWN: ${pathOrId}`);
  return page;
}

export function renderPage(site: SiteDocument, pathOrId: string) {
  const page = resolvePage(site, pathOrId);
  if (page.sections.length === 0) {
    return (
      <div data-page-id={page.id} className="grid min-h-screen place-items-center px-6">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          {page.metadata.title}
        </h1>
      </div>
    );
  }
  return (
    <div data-page-id={page.id}>
      {page.sections.map((section) => (
        <React.Fragment key={(section as { id: string }).id}>
          {renderSection(section, site)}
        </React.Fragment>
      ))}
    </div>
  );
}
