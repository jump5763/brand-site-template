import type {
  SeasonalGridSection,
  SiteDocument,
} from "@/templates/b/site-schema/generated/types";
import { resolveAction } from "@/templates/b/site-schema/runtime/resolve-link";
import { resolveMedia } from "@/templates/b/site-schema/runtime/resolve-media";
import SeasonalGridView, { type SeasonalGridProps } from "./view";

export const toProps = (
  section: SeasonalGridSection,
  site: SiteDocument,
): SeasonalGridProps => ({
  id: section.id,
  eyebrow: section.content.eyebrow,
  title: section.content.title,
  description: section.content.description,
  action: section.content.action
    ? resolveAction(section.content.action, site)
    : undefined,
  items: section.content.items.map((item) => ({
    ...item,
    media: resolveMedia(item.media),
  })),
});

export default {
  id: "seasonal.grid",
  type: "seasonal",
  variant: "grid",
  toProps,
  render: (section: SeasonalGridSection, site: SiteDocument) => (
    <SeasonalGridView {...toProps(section, site)} />
  ),
} as const;
