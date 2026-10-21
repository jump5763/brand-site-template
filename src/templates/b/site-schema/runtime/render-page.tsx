import React from "react";
import type { SiteDocument } from "./load-site";
import { renderSection } from "../generated";

const instanceId = (section: Readonly<{ id: string }>) => section.id;

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
      <div data-page-id={page.id} className="grid flex-1 place-items-center px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          {page.metadata.title}
        </h1>
      </div>
    );
  }
  return (
    <div data-page-id={page.id} className="flex-1">
      {page.sections.map((section) => (
        <React.Fragment key={instanceId(section)}>{renderSection(section, site)}</React.Fragment>
      ))}
    </div>
  );
}
