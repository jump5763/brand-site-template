import type { HomeHeroSection, SiteDocument } from "@/site-schema/generated/types";
import { resolveAction } from "@/site-schema/runtime/resolve-link";
import { resolveMedia } from "@/site-schema/runtime/resolve-media";
import HomeHeroView, { type HomeHeroProps } from "./view";

export const toProps = (
  section: HomeHeroSection,
  site: SiteDocument,
): HomeHeroProps => ({
  id: section.id,
  eyebrow: section.content.eyebrow,
  title: section.content.title,
  description: section.content.description,
  media: resolveMedia(section.content.media),
  primaryAction: resolveAction(section.content.primaryAction, site),
  secondaryAction: resolveAction(section.content.secondaryAction, site),
  highlights: section.content.highlights.map((item) => ({
    id: item.id,
    value: item.value,
    label: item.label,
  })),
  scrollHint: section.content.scrollHint,
});

export default {
  id: "home.hero",
  type: "home",
  variant: "hero",
  toProps,
  render: (section: HomeHeroSection, site: SiteDocument) => (
    <HomeHeroView {...toProps(section, site)} />
  ),
} as const;
