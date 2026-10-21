import type { SourcingStoryDefaultSection } from "@/templates/a/site-schema/generated/types";
import { resolveMedia } from "@/templates/a/site-schema/runtime/resolve-media";
import SourcingStoryView, { type SourcingStoryProps } from "./view";

export const toProps = (section: SourcingStoryDefaultSection): SourcingStoryProps => ({
  id: section.id,
  eyebrow: section.content.eyebrow,
  title: section.content.title,
  description: section.content.description,
  body: section.content.body,
  image: resolveMedia(section.content.image),
  stats: section.content.stats,
  practices: section.content.practices,
});

export default {
  id: "sourcing-story.default",
  type: "sourcing-story",
  variant: "default",
  toProps,
  render: (section: SourcingStoryDefaultSection) => (
    <SourcingStoryView {...toProps(section)} />
  ),
} as const;
