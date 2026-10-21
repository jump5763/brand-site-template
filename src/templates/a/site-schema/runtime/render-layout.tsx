import type { ReactNode } from "react";
import { renderSection } from "../generated";
import type { SiteDocument } from "../generated/types";

export function SiteLayout({ site, children }: { site: SiteDocument; children: ReactNode }) {
  const header = site.layout.header;
  const footer = site.layout.footer;
  return (
    <div className="flex min-h-dvh flex-col">
      <span id="top" aria-hidden="true" className="absolute" />
      {header ? renderSection(header, site) : null}
      <main id="main-content" className="flex flex-1 flex-col">
        {children}
      </main>
      {footer ? renderSection(footer, site) : null}
    </div>
  );
}
