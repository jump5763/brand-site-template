import type { OrderCtaDefaultSection, SiteDocument } from "@/templates/a/site-schema/generated/types";
import { resolveAction } from "@/templates/a/site-schema/runtime/resolve-link";
import { resolveMedia } from "@/templates/a/site-schema/runtime/resolve-media";
import OrderCtaView, { type OrderCtaProps } from "./view";

export const toProps = (section: OrderCtaDefaultSection, site: SiteDocument): OrderCtaProps => ({
  id: section.id,
  eyebrow: section.content.eyebrow,
  title: section.content.title,
  description: section.content.description,
  image: resolveMedia(section.content.image),
  primaryAction: resolveAction(section.content.primaryAction, site),
  secondaryAction: resolveAction(section.content.secondaryAction, site),
});

export default {
  id: "order-cta.default",
  type: "order-cta",
  variant: "default",
  toProps,
  render: (section: OrderCtaDefaultSection, site: SiteDocument) => (
    <OrderCtaView {...toProps(section, site)} />
  ),
} as const;
