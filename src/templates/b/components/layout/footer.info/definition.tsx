import type { FooterInfoSection, SiteDocument } from "@/templates/b/site-schema/generated/types";
import { resolveLinkTarget } from "@/templates/b/site-schema/runtime/resolve-link";
import FooterInfoView, { type FooterInfoProps } from "./view";

export const toProps = (
  section: FooterInfoSection,
  site: SiteDocument,
): FooterInfoProps => ({
  id: section.id,
  brandName: section.content.brandName,
  tagline: section.content.tagline,
  note: section.content.note,
  copyright: section.content.copyright,
  columns: section.content.columns.map((column) => ({
    id: column.id,
    title: column.title,
    links: column.links.map((link) => ({
      id: link.id,
      label: link.label,
      href: resolveLinkTarget(link.target, site),
    })),
  })),
  contact: section.content.contact,
  hours: section.content.hours,
});

export default {
  id: "footer.info",
  type: "footer",
  variant: "info",
  toProps,
  render: (section: FooterInfoSection, site: SiteDocument) => (
    <FooterInfoView {...toProps(section, site)} />
  ),
} as const;
