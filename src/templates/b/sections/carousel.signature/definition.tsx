import type {
  CarouselSignatureSection,
  SiteDocument,
} from "@/templates/b/site-schema/generated/types";
import { resolveAction } from "@/templates/b/site-schema/runtime/resolve-link";
import { resolveMedia } from "@/templates/b/site-schema/runtime/resolve-media";
import CarouselSignatureView, {
  type CarouselSignatureProps,
} from "./view";

export const toProps = (
  section: CarouselSignatureSection,
  site: SiteDocument,
): CarouselSignatureProps => ({
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
  id: "carousel.signature",
  type: "carousel",
  variant: "signature",
  toProps,
  render: (section: CarouselSignatureSection, site: SiteDocument) => (
    <CarouselSignatureView {...toProps(section, site)} />
  ),
} as const;
