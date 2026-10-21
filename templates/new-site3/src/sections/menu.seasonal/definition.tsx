import type { MenuSeasonalSection, SiteDocument } from "@/site-schema/generated/types";
import { resolveAction } from "@/site-schema/runtime/resolve-link";
import { resolveMedia } from "@/site-schema/runtime/resolve-media";
import MenuSeasonalView, { type MenuSeasonalProps } from "./view";

export const toProps = (
  section: MenuSeasonalSection,
  site: SiteDocument,
): MenuSeasonalProps => ({
  id: section.id,
  eyebrow: section.content.eyebrow,
  title: section.content.title,
  description: section.content.description,
  action: resolveAction(section.content.action, site),
  dishes: section.content.dishes.map((dish) => ({
    id: dish.id,
    name: dish.name,
    description: dish.description,
    price: dish.price,
    calories: dish.calories,
    badge: dish.badge,
    tags: dish.tags,
    media: resolveMedia(dish.media),
  })),
});

export default {
  id: "menu.seasonal",
  type: "menu",
  variant: "seasonal",
  toProps,
  render: (section: MenuSeasonalSection, site: SiteDocument) => (
    <MenuSeasonalView {...toProps(section, site)} />
  ),
} as const;
