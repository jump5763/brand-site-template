import type { SiteDocument, StoryAboutSection } from "@/site-schema/generated/types";
import { resolveAction } from "@/site-schema/runtime/resolve-link";
import { resolveMedia } from "@/site-schema/runtime/resolve-media";
import StoryAboutView, { type StoryAboutProps } from "./view";

export const toProps = (
  section: StoryAboutSection,
  site: SiteDocument,
): StoryAboutProps => ({
  id: section.id,
  eyebrow: section.content.eyebrow,
  title: section.content.title,
  description: section.content.description,
  body: [...section.content.body],
  media: resolveMedia(section.content.media),
  secondaryMedia: resolveMedia(section.content.secondaryMedia),
  stats: section.content.stats.map((stat) => ({
    id: stat.id,
    value: stat.value,
    label: stat.label,
  })),
  action: resolveAction(section.content.action, site),
});

export default {
  id: "story.about",
  type: "story",
  variant: "about",
  toProps,
  render: (section: StoryAboutSection, site: SiteDocument) => (
    <StoryAboutView {...toProps(section, site)} />
  ),
} as const;
