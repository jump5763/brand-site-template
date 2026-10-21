import type {
  OrderChannelsSection,
  SiteDocument,
} from "@/templates/b/site-schema/generated/types";
import { resolveAction } from "@/templates/b/site-schema/runtime/resolve-link";
import OrderChannelsView, { type OrderChannelsProps } from "./view";

export const toProps = (
  section: OrderChannelsSection,
  site: SiteDocument,
): OrderChannelsProps => ({
  id: section.id,
  eyebrow: section.content.eyebrow,
  title: section.content.title,
  description: section.content.description,
  note: section.content.note,
  items: section.content.items.map((item) => ({
    id: item.id,
    channel: item.channel,
    title: item.title,
    description: item.description,
    action: item.action ? resolveAction(item.action, site) : undefined,
  })),
});

export default {
  id: "order.channels",
  type: "order",
  variant: "channels",
  toProps,
  render: (section: OrderChannelsSection, site: SiteDocument) => (
    <OrderChannelsView {...toProps(section, site)} />
  ),
} as const;
