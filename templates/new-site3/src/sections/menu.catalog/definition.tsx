import type { MenuCatalogSection, SiteDocument } from "@/site-schema/generated/types";
import { resolveMedia } from "@/site-schema/runtime/resolve-media";
import MenuCatalogView, { type MenuCatalogProps } from "./view";

export const toProps = (
  section: MenuCatalogSection,
  site: SiteDocument,
): MenuCatalogProps => {
  void site; /* no links to resolve */
  return {
    id: section.id,
    eyebrow: section.content.eyebrow,
    title: section.content.title,
    description: section.content.description,
    allLabel: section.content.allLabel,
    categories: section.content.categories.map((category) => ({
      id: category.id,
      label: category.label,
    })),
    sorts: section.content.sorts.map((sort) => ({
      id: sort.id,
      label: sort.label,
    })),
    dishes: section.content.dishes.map((dish) => ({
      id: dish.id,
      name: dish.name,
      description: dish.description,
      price: dish.price,
      categoryId: dish.categoryId,
      calories: dish.calories,
      badge: dish.badge,
      tags: dish.tags,
      media: resolveMedia(dish.media),
    })),
    resultsLabel: section.content.resultsLabel,
    emptyState: section.content.emptyState,
    priceNote: section.content.priceNote,
  };
};

export default {
  id: "menu.catalog",
  type: "menu",
  variant: "catalog",
  toProps,
  render: (section: MenuCatalogSection, site: SiteDocument) => (
    <MenuCatalogView {...toProps(section, site)} />
  ),
} as const;
