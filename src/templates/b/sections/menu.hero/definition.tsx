import type { MenuHeroSection } from "@/templates/b/site-schema/generated/types";
import MenuHeroView, { type MenuHeroProps } from "./view";

export const toProps = (section: MenuHeroSection): MenuHeroProps => ({
  id: section.id,
  eyebrow: section.content.eyebrow,
  title: section.content.title,
  description: section.content.description,
  highlights: section.content.highlights,
});

export default {
  id: "menu.hero",
  type: "menu",
  variant: "hero",
  toProps,
  render: (section: MenuHeroSection) => <MenuHeroView {...toProps(section)} />,
} as const;
