import type { SeasonalPicksDefaultSection, SiteDocument } from "@/templates/a/site-schema/generated/types";
import { resolveAction } from "@/templates/a/site-schema/runtime/resolve-link";
import { resolveMedia } from "@/templates/a/site-schema/runtime/resolve-media";
import SeasonalPicksView, { type SeasonalPicksProps } from "./view";

export const toProps = (
  section: SeasonalPicksDefaultSection,
  site: SiteDocument,
): SeasonalPicksProps => ({
  id: section.id,
  eyebrow: section.content.eyebrow,
  title: section.content.title,
  description: section.content.description,
  action: resolveAction(section.content.action, site),
  items: section.content.items.map((item) => ({
    name: item.name,
    description: item.description,
    price: item.price,
    badge: item.badge,
    image: resolveMedia(item.image),
  })),
});

export default {
  id: "seasonal-picks.default",
  type: "seasonal-picks",
  variant: "default",
  toProps,
  render: (section: SeasonalPicksDefaultSection, site: SiteDocument) => (
    <SeasonalPicksView {...toProps(section, site)} />
  ),
} as const;
