import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Reveal } from "@/templates/b/components/shared/reveal";
import { Section } from "@/templates/b/components/shared/section";
import { SectionHeader } from "@/templates/b/components/shared/section-header";
import { Button } from "@/templates/b/components/ui/button";
import { Image } from "@/templates/b/components/ui/Image";
import type { ResolvedMedia } from "@/templates/b/site-schema/runtime/resolve-media";
import type { ResolvedAction } from "@/templates/b/site-schema/runtime/resolve-link";

export type SeasonalGridItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  badge: string;
  media: ResolvedMedia;
};

export type SeasonalGridProps = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  action?: ResolvedAction;
  items: readonly SeasonalGridItem[];
};

const priceFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export default function SeasonalGridView({
  id,
  eyebrow,
  title,
  description,
  action,
  items,
}: SeasonalGridProps) {
  const headingId = `${id}-heading`;

  return (
    <Section
      id={id}
      aria-labelledby={headingId}
      spacing="spacious"
      className="scroll-mt-24 desktop:scroll-mt-28"
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
        {items.map((item, index) => (
          <Reveal key={item.id} delay={index * 80}>
            <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-md">
              <div className="relative overflow-hidden">
                <Image
                  media={item.media}
                  className="aspect-[4/3] h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                />
                <span className="absolute left-4 top-4 rounded-full bg-background/95 px-3 py-1 text-[12px] font-medium text-primary shadow-sm">
                  {item.badge}
                </span>
              </div>
              <div className="flex flex-1 flex-col p-6">
                <h3 className="font-heading text-[20px] font-semibold leading-snug text-foreground tablet:text-[22px]">
                  {item.name}
                </h3>
                <p className="mt-2 font-body text-sm leading-[1.6] text-muted-foreground">
                  {item.description}
                </p>
                <p className="mt-5 font-heading text-[18px] font-semibold text-primary">
                  {priceFormat.format(item.price)}
                </p>
              </div>
            </article>
          </Reveal>
        ))}
      </div>
      {action ? (
        <div className="mt-12 flex justify-center">
          <Button asChild variant="outline" className="h-12 rounded-full px-7">
            {action.href.startsWith("/") ? (
              <Link href={action.href}>
                {action.label}
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            ) : (
              <a href={action.href} target="_blank" rel="noopener noreferrer">
                {action.label}
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </a>
            )}
          </Button>
        </div>
      ) : null}
    </Section>
  );
}
