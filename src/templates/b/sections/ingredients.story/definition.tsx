import type {
  IngredientsStorySection,
  SiteDocument,
} from "@/templates/b/site-schema/generated/types";
import { resolveAction } from "@/templates/b/site-schema/runtime/resolve-link";
import { resolveMedia } from "@/templates/b/site-schema/runtime/resolve-media";
import IngredientsStoryView, {
  type IngredientsStoryProps,
} from "./view";

export const toProps = (
  section: IngredientsStorySection,
  site: SiteDocument,
): IngredientsStoryProps => ({
  id: section.id,
  eyebrow: section.content.eyebrow,
  title: section.content.title,
  description: section.content.description,
  media: resolveMedia(section.content.media),
  action: section.content.action
    ? resolveAction(section.content.action, site)
    : undefined,
  facts: section.content.facts,
  stats: section.content.stats,
});

export default {
  id: "ingredients.story",
  type: "ingredients",
  variant: "story",
  toProps,
  render: (section: IngredientsStorySection, site: SiteDocument) => (
    <IngredientsStoryView {...toProps(section, site)} />
  ),
} as const;
