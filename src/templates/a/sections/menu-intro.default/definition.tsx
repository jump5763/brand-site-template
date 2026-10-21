import type { MenuIntroDefaultSection } from "@/templates/a/site-schema/generated/types";
import { resolveMedia } from "@/templates/a/site-schema/runtime/resolve-media";
import MenuIntroView, { type MenuIntroProps } from "./view";

export const toProps = (section: MenuIntroDefaultSection): MenuIntroProps => ({
  id: section.id,
  eyebrow: section.content.eyebrow,
  title: section.content.title,
  description: section.content.description,
  meta: section.content.meta,
  image: resolveMedia(section.content.image),
});

export default {
  id: "menu-intro.default",
  type: "menu-intro",
  variant: "default",
  toProps,
  render: (section: MenuIntroDefaultSection) => <MenuIntroView {...toProps(section)} />,
} as const;
