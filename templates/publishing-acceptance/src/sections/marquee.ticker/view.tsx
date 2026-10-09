import { Fragment } from "react";

import { Section } from "@/components/shared/section";

export type MarqueeTickerProps = {
  id: string;
  label: string;
  items: string[];
};

// The marquee animation translates the track by -50%, so both copies must be
// identical: same items and same classes.
function MarqueeTrack({
  items,
  hidden = false,
}: {
  items: string[];
  hidden?: boolean;
}) {
  return (
    <div
      aria-hidden={hidden ? "true" : undefined}
      className="flex shrink-0 items-center"
    >
      {items.map((item, index) => (
        <Fragment key={`${item}-${index}`}>
          <span className="text-[12px] font-medium uppercase tracking-[0.28em] whitespace-nowrap tablet:text-[13px]">
            {item}
          </span>
          <span
            aria-hidden="true"
            className="mx-8 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-foreground/35 tablet:mx-10"
          />
        </Fragment>
      ))}
    </div>
  );
}

export default function MarqueeTickerView({
  id,
  label,
  items,
}: MarqueeTickerProps) {
  return (
    <Section
      id={id}
      spacing="none"
      container="none"
      aria-label={label}
      className="overflow-hidden border-y border-primary/20 bg-primary py-4 text-primary-foreground"
    >
      <div className="group flex">
        <div className="flex w-max animate-marquee items-center group-hover:[animation-play-state:paused] motion-reduce:animate-none">
          <MarqueeTrack items={items} />
          <MarqueeTrack items={items} hidden />
        </div>
      </div>
    </Section>
  );
}
