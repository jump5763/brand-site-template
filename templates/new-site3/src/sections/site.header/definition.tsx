import type { SiteDocument, SiteHeaderSection } from "@/site-schema/generated/types";
import { resolveAction, resolveLinkTarget } from "@/site-schema/runtime/resolve-link";
import SiteHeaderView, { type SiteHeaderProps } from "./view";

export const toProps = (
  section: SiteHeaderSection,
  site: SiteDocument,
): SiteHeaderProps => ({
  id: section.id,
  brandName: section.content.brandName,
  brandTagline: section.content.brandTagline,
  brandHref: resolveLinkTarget(section.content.brandTarget, site),
  navigationLabel: section.content.navigationLabel,
  navigation: section.content.navigation.map((item) => ({
    id: item.id,
    label: item.label,
    href: resolveLinkTarget(item.target, site),
  })),
  action: resolveAction(section.content.action, site),
});

export default {
  id: "site.header",
  type: "site",
  variant: "header",
  toProps,
  render: (section: SiteHeaderSection, site: SiteDocument) => (
    <SiteHeaderView {...toProps(section, site)} />
  ),
} as const;
