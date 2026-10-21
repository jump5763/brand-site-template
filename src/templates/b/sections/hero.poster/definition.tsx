import type { HeroPosterSection, SiteDocument } from "@/templates/b/site-schema/generated/types";
import { resolveAction } from "@/templates/b/site-schema/runtime/resolve-link";
import { resolveMedia } from "@/templates/b/site-schema/runtime/resolve-media";
import HeroPosterView, { type HeroPosterProps } from "./view";

export const toProps = (
  section: HeroPosterSection,
  site: SiteDocument,
): HeroPosterProps => ({
  id: section.id,
  eyebrow: section.content.eyebrow,
  title: section.content.title,
  description: section.content.description,
  primaryAction: resolveAction(section.content.primaryAction, site),
  secondaryAction: section.content.secondaryAction
    ? resolveAction(section.content.secondaryAction, site)
    : undefined,
  badges: section.content.badges,
  media: resolveMedia(section.content.media),
});

export default {
  id: "hero.poster",
  type: "hero",
  variant: "poster",
  toProps,
  render: (section: HeroPosterSection, site: SiteDocument) => (
    <HeroPosterView {...toProps(section, site)} />
  ),
} as const;
