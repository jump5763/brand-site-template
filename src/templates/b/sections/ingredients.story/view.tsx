import Link from "next/link";
import { ArrowRight, Leaf } from "lucide-react";

import { Reveal } from "@/templates/b/components/shared/reveal";
import { Section } from "@/templates/b/components/shared/section";
import { SectionHeader } from "@/templates/b/components/shared/section-header";
import { Button } from "@/templates/b/components/ui/button";
import { Image } from "@/templates/b/components/ui/Image";
import type { ResolvedMedia } from "@/templates/b/site-schema/runtime/resolve-media";
import type { ResolvedAction } from "@/templates/b/site-schema/runtime/resolve-link";

export type IngredientsStoryFact = {
  id: string;
  title: string;
  description: string;
};

export type IngredientsStoryStat = {
  id: string;
  value: string;
  label: string;
};

export type IngredientsStoryProps = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  media: ResolvedMedia;
  action?: ResolvedAction;
  facts: readonly IngredientsStoryFact[];
  stats: readonly IngredientsStoryStat[];
};

export default function IngredientsStoryView({
  id,
  eyebrow,
  title,
  description,
  media,
  action,
  facts,
  stats,
}: IngredientsStoryProps) {
  const headingId = `${id}-heading`;

  return (
    <Section
      id={id}
      aria-labelledby={headingId}
      spacing="spacious"
      className="scroll-mt-24 bg-secondary/30 desktop:scroll-mt-28"
    >
      <div className="grid gap-12 desktop:grid-cols-2 desktop:items-center desktop:gap-16">
        <Reveal>
          <div className="overflow-hidden rounded-3xl">
            <Image
              media={media}
              className="aspect-[4/3] w-full object-cover desktop:aspect-[4/5]"
            />
          </div>
        </Reveal>
        <div>
          <SectionHeader
            headingId={headingId}
            headingLevel={2}
            eyebrow={eyebrow}
            title={title}
            description={description}
          />
          <div className="mt-8 space-y-6">
            {facts.map((fact) => (
              <div key={fact.id} className="flex gap-4">
                <Leaf aria-hidden="true" size={20} className="mt-1 text-primary" />
                <div>
                  <h3 className="font-heading text-[17px] font-semibold text-foreground">
                    {fact.title}
                  </h3>
                  <p className="mt-1 font-body text-sm leading-[1.6] text-muted-foreground">
                    {fact.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
          {action ? (
            <Button asChild variant="outline" className="mt-9 h-12 rounded-full px-7">
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
          ) : null}
        </div>
      </div>
      <Reveal>
        <dl className="mt-16 grid gap-8 border-t border-border pt-10 tablet:grid-cols-3">
          {stats.map((stat) => (
            <div key={stat.id}>
              <dt className="font-body text-[12px] uppercase tracking-[0.12em] text-muted-foreground">
                {stat.label}
              </dt>
              <dd className="mt-2 font-heading text-[32px] font-semibold text-primary tablet:text-[40px]">
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
      </Reveal>
    </Section>
  );
}
