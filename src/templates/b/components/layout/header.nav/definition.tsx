import type { HeaderNavSection, SiteDocument } from "@/templates/b/site-schema/generated/types";
import {
  resolveAction,
  resolveLinkTarget,
} from "@/templates/b/site-schema/runtime/resolve-link";
import HeaderNavView, { type HeaderNavProps } from "./view";

export const toProps = (
  section: HeaderNavSection,
  site: SiteDocument,
): HeaderNavProps => ({
  id: section.id,
  brandName: section.content.brandName,
  items: section.content.items.map((item) => ({
    id: item.id,
    label: item.label,
    href: resolveLinkTarget(item.target, site),
  })),
  cta: resolveAction(section.content.cta, site),
});

export default {
  id: "header.nav",
  type: "header",
  variant: "nav",
  toProps,
  render: (section: HeaderNavSection, site: SiteDocument) => (
    <HeaderNavView {...toProps(section, site)} />
  ),
} as const;
