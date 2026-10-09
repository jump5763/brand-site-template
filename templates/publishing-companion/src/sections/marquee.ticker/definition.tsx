import type { MarqueeTickerSection, SiteDocument } from "@/site-schema/generated/types";
import MarqueeTickerView, { type MarqueeTickerProps } from "./view";

export const toProps = (
  section: MarqueeTickerSection,
  site: SiteDocument,
): MarqueeTickerProps => {
  void site; // Ticker content has no links or media to resolve.
  return {
    id: section.id,
    label: section.content.label,
    items: section.content.items,
  };
};

export default {
  id: "marquee.ticker",
  type: "marquee",
  variant: "ticker",
  toProps,
  render: (section: MarqueeTickerSection, site: SiteDocument) => (
    <MarqueeTickerView {...toProps(section, site)} />
  ),
} as const;
