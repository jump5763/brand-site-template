import type { SiteDocument, SiteFooterSection } from "@/site-schema/generated/types";
import { resolveLinkTarget } from "@/site-schema/runtime/resolve-link";
import SiteFooterView, { type SiteFooterProps } from "./view";

export const toProps = (
  section: SiteFooterSection,
  site: SiteDocument,
): SiteFooterProps => {
  const { content } = section;
  return {
    id: section.id,
    brandName: content.brandName,
    headline: content.headline,
    description: content.description,
    columnTitles: content.columnTitles,
    stores: content.stores,
    hours: content.hours,
    hoursNote: content.hoursNote,
    explore: content.explore.map((item) => ({
      id: item.id,
      label: item.label,
      href: resolveLinkTarget(item.target, site),
    })),
    contact: {
      email: content.contact.email,
      phone: content.contact.phone,
      social: content.contact.social.map((item) => ({
        id: item.id,
        label: item.label,
        href: resolveLinkTarget(item.target, site),
      })),
    },
    legalNote: content.legalNote,
  };
};

export default {
  id: "site.footer",
  type: "site",
  variant: "footer",
  toProps,
  render: (section: SiteFooterSection, site: SiteDocument) => (
    <SiteFooterView {...toProps(section, site)} />
  ),
} as const;
