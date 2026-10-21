import Link from "next/link";
import { ArrowRight, Bike, ShoppingBag, Users } from "lucide-react";

import { Reveal } from "@/templates/b/components/shared/reveal";
import { Section } from "@/templates/b/components/shared/section";
import { SectionHeader } from "@/templates/b/components/shared/section-header";
import type { ResolvedAction } from "@/templates/b/site-schema/runtime/resolve-link";

export type OrderChannelsItem = {
  id: string;
  channel: "pickup" | "delivery" | "catering";
  title: string;
  description: string;
  action?: ResolvedAction;
};

export type OrderChannelsProps = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  note?: string;
  items: readonly OrderChannelsItem[];
};

const channelIcons = {
  pickup: ShoppingBag,
  delivery: Bike,
  catering: Users,
} as const;

const linkClassName =
  "mt-6 inline-flex items-center gap-2 font-body text-sm font-medium text-primary";

export default function OrderChannelsView({
  id,
  eyebrow,
  title,
  description,
  note,
  items,
}: OrderChannelsProps) {
  const headingId = `${id}-heading`;

  return (
    <Section
      id={id}
      aria-labelledby={headingId}
      spacing="spacious"
      className="scroll-mt-24 bg-secondary/40 desktop:scroll-mt-28"
    >
      <Reveal>
        <SectionHeader
          headingId={headingId}
          headingLevel={2}
          eyebrow={eyebrow}
          title={title}
          description={description}
        />
      </Reveal>
      <div className="mt-12 grid gap-8 tablet:grid-cols-2 desktop:grid-cols-3">
        {items.map((item, index) => {
          const ChannelIcon = channelIcons[item.channel] ?? channelIcons.pickup;
          return (
            <Reveal key={item.id} delay={index * 80}>
              <article className="group flex h-full flex-col rounded-2xl border border-border bg-card p-8 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-md">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-primary">
                  <ChannelIcon aria-hidden="true" className="h-5 w-5" />
                </span>
                <h3 className="mt-6 font-heading text-[19px] font-semibold">
                  {item.title}
                </h3>
                <p className="mt-3 font-body text-sm leading-[1.6] text-muted-foreground">
                  {item.description}
                </p>
                {item.action ? (
                  item.action.href.startsWith("/") ? (
                    <Link href={item.action.href} className={linkClassName}>
                      {item.action.label}
                      <ArrowRight
                        aria-hidden="true"
                        className="h-4 w-4 transition-transform group-hover:translate-x-1"
                      />
                    </Link>
                  ) : (
                    <a
                      href={item.action.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={linkClassName}
                    >
                      {item.action.label}
                      <ArrowRight
                        aria-hidden="true"
                        className="h-4 w-4 transition-transform group-hover:translate-x-1"
                      />
                    </a>
                  )
                ) : null}
              </article>
            </Reveal>
          );
        })}
      </div>
      {note ? (
        <p className="mt-10 font-body text-[13px] leading-[1.6] text-muted-foreground">
          {note}
        </p>
      ) : null}
    </Section>
  );
}
