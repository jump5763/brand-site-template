import type { IngredientsFreshSection, SiteDocument } from "@/site-schema/generated/types";
import { resolveMedia } from "@/site-schema/runtime/resolve-media";
import IngredientsFreshView, { type IngredientsFreshProps } from "./view";

export const toProps = (
  section: IngredientsFreshSection,
  site: SiteDocument,
): IngredientsFreshProps => {
  void site; // Ingredient content has no links to resolve.
  return {
    id: section.id,
    eyebrow: section.content.eyebrow,
    title: section.content.title,
    description: section.content.description,
    items: section.content.items.map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      icon: item.icon,
      media: resolveMedia(item.media),
    })),
    note: section.content.note,
  };
};

export default {
  id: "ingredients.fresh",
  type: "ingredients",
  variant: "fresh",
  toProps,
  render: (section: IngredientsFreshSection, site: SiteDocument) => (
    <IngredientsFreshView {...toProps(section, site)} />
  ),
} as const;
