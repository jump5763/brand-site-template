import type { MenuIntroSection, SiteDocument } from "@/site-schema/generated/types";
import { resolveMedia } from "@/site-schema/runtime/resolve-media";
import MenuIntroView, { type MenuIntroProps } from "./view";

export const toProps = (
  section: MenuIntroSection,
  site: SiteDocument,
): MenuIntroProps => {
  void site; // Menu intro has no links to resolve.
  return {
    id: section.id,
    eyebrow: section.content.eyebrow,
    title: section.content.title,
    description: section.content.description,
    media: resolveMedia(section.content.media),
    highlights: section.content.highlights.map((highlight) => ({
      id: highlight.id,
      value: highlight.value,
      label: highlight.label,
    })),
    note: section.content.note,
  };
};

export default {
  id: "menu.intro",
  type: "menu",
  variant: "intro",
  toProps,
  render: (section: MenuIntroSection, site: SiteDocument) => (
    <MenuIntroView {...toProps(section, site)} />
  ),
} as const;
