import type { HeroDefaultSection } from "@/templates/a/site-schema/generated/types";
import type { SiteDocument } from "@/templates/a/site-schema/generated/types";
import { resolveAction } from "@/templates/a/site-schema/runtime/resolve-link";
import { resolveMedia } from "@/templates/a/site-schema/runtime/resolve-media";
import HeroView, { type HeroProps } from "./view";

export const toProps = (section: HeroDefaultSection, site: SiteDocument): HeroProps => ({
  id: section.id,
  eyebrow: section.content.eyebrow,
  title: section.content.title,
  description: section.content.description,
  badges: section.content.badges,
  image: resolveMedia(section.content.image),
  primaryAction: resolveAction(section.content.primaryAction, site),
  secondaryAction: resolveAction(section.content.secondaryAction, site),
});

export default {
  id: "hero.default",
  type: "hero",
  variant: "default",
  toProps,
  render: (section: HeroDefaultSection, site: SiteDocument) => (
    <HeroView {...toProps(section, site)} />
  ),
} as const;
