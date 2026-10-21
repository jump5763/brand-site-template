import type { SiteDocument, SiteHeaderDefaultSection } from "@/templates/a/site-schema/generated/types";
import { resolveAction } from "@/templates/a/site-schema/runtime/resolve-link";
import SiteHeaderView, { type SiteHeaderProps } from "./view";

export const toProps = (
  section: SiteHeaderDefaultSection,
  site: SiteDocument,
): SiteHeaderProps => ({
  id: section.id,
  brandName: section.content.brandName,
  nav: section.content.nav.map((item) => ({
    label: item.label,
    href: resolveAction({ label: item.label, target: item.target }, site).href,
  })),
  orderAction: resolveAction(section.content.orderAction, site),
  openMenuLabel: section.content.openMenuLabel,
  closeMenuLabel: section.content.closeMenuLabel,
  sheetTitle: section.content.sheetTitle,
});

export default {
  id: "site-header.default",
  type: "site-header",
  variant: "default",
  toProps,
  render: (section: SiteHeaderDefaultSection, site: SiteDocument) => (
    <SiteHeaderView {...toProps(section, site)} />
  ),
} as const;
