import type { MenuCatalogDefaultSection, SiteDocument } from "@/templates/a/site-schema/generated/types";
import { resolveAction } from "@/templates/a/site-schema/runtime/resolve-link";
import { resolveMedia } from "@/templates/a/site-schema/runtime/resolve-media";
import MenuCatalogView, { type MenuCatalogProps } from "./view";

export const toProps = (section: MenuCatalogDefaultSection, site: SiteDocument): MenuCatalogProps => ({
  id: section.id,
  eyebrow: section.content.eyebrow,
  title: section.content.title,
  description: section.content.description,
  orderAction: resolveAction(section.content.orderAction, site),
  labels: {
    all: section.content.allLabel,
    filter: section.content.filterLabel,
    clear: section.content.clearLabel,
    sort: section.content.sortLabel,
    result: section.content.resultLabel,
    empty: section.content.emptyMessage,
  },
  categories: section.content.categories,
  filters: section.content.filters,
  sortOptions: section.content.sortOptions,
  items: section.content.items.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    price: item.price,
    calories: item.calories,
    category: item.category,
    tags: item.tags,
    badge: item.badge,
    featured: item.featured ?? false,
    image: resolveMedia(item.image),
  })),
});

export default {
  id: "menu-catalog.default",
  type: "menu-catalog",
  variant: "default",
  toProps,
  render: (section: MenuCatalogDefaultSection, site: SiteDocument) => (
    <MenuCatalogView {...toProps(section, site)} />
  ),
} as const;
