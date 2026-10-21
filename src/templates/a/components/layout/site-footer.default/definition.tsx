import type { SiteDocument, SiteFooterDefaultSection } from "@/templates/a/site-schema/generated/types";
import { resolveAction } from "@/templates/a/site-schema/runtime/resolve-link";
import SiteFooterView, { type SiteFooterProps } from "./view";

const resolveLinks = (
  links: readonly { label: string; target: Parameters<typeof resolveAction>[0]["target"] }[],
  site: SiteDocument,
) => links.map((link) => ({ label: link.label, href: resolveAction(link, site).href }));

export const toProps = (
  section: SiteFooterDefaultSection,
  site: SiteDocument,
): SiteFooterProps => ({
  id: section.id,
  brandName: section.content.brandName,
  brandDescription: section.content.brandDescription,
  orderAction: resolveAction(section.content.orderAction, site),
  newsletter: section.content.newsletter,
  navGroups: section.content.navGroups.map((group) => ({
    title: group.title,
    links: resolveLinks(group.links, site),
  })),
  stores: section.content.stores,
  hoursTitle: section.content.hoursTitle,
  hoursLines: section.content.hoursLines,
  socialTitle: section.content.socialTitle,
  social: section.content.social,
  legalLinks: resolveLinks(section.content.legalLinks, site),
  copyright: section.content.copyright,
});

export default {
  id: "site-footer.default",
  type: "site-footer",
  variant: "default",
  toProps,
  render: (section: SiteFooterDefaultSection, site: SiteDocument) => (
    <SiteFooterView {...toProps(section, site)} />
  ),
} as const;
