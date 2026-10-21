import type { MenuCatalogSection } from "@/templates/b/site-schema/generated/types";
import { resolveMedia } from "@/templates/b/site-schema/runtime/resolve-media";
import MenuCatalogView, { type MenuCatalogProps } from "./view";

export const toProps = (section: MenuCatalogSection): MenuCatalogProps => ({
  id: section.id,
  categories: section.content.categories,
  items: section.content.items.map((item) => ({
    ...item,
    media: resolveMedia(item.media),
  })),
});

export default {
  id: "menu.catalog",
  type: "menu",
  variant: "catalog",
  toProps,
  render: (section: MenuCatalogSection) => (
    <MenuCatalogView {...toProps(section)} />
  ),
} as const;
