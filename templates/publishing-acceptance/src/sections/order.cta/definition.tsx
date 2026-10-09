import type { OrderCtaSection, SiteDocument } from "@/site-schema/generated/types";
import { resolveAction } from "@/site-schema/runtime/resolve-link";
import OrderCtaView, { type OrderCtaProps } from "./view";

export const toProps = (
  section: OrderCtaSection,
  site: SiteDocument,
): OrderCtaProps => ({
  id: section.id,
  eyebrow: section.content.eyebrow,
  title: section.content.title,
  description: section.content.description,
  primaryAction: resolveAction(section.content.primaryAction, site),
  secondaryAction: resolveAction(section.content.secondaryAction, site),
  perks: [...section.content.perks],
  note: section.content.note,
});

export default {
  id: "order.cta",
  type: "order",
  variant: "cta",
  toProps,
  render: (section: OrderCtaSection, site: SiteDocument) => (
    <OrderCtaView {...toProps(section, site)} />
  ),
} as const;
