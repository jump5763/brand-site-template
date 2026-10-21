import { ArrowRight } from "lucide-react";

import { ActionLink } from "@/templates/a/components/shared/action-link";
import { Section } from "@/templates/a/components/shared/section";
import { SectionHeader } from "@/templates/a/components/shared/section-header";
import { Button } from "@/templates/a/components/ui/button";
import { Image } from "@/templates/a/components/ui/Image";
import { Body } from "@/templates/a/components/ui/typography/Body";
import { Heading } from "@/templates/a/components/ui/typography/Heading";
import type { ResolvedAction } from "@/templates/a/site-schema/runtime/resolve-link";
import type { ResolvedMedia } from "@/templates/a/site-schema/runtime/resolve-media";

export type SeasonalPicksProps = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  action: ResolvedAction;
  items: readonly {
    name: string;
    description: string;
    price: string;
    badge?: string;
    image: ResolvedMedia;
  }[];
};

// In-season dish cards below the page h1: one section h2, one h3 per dish.
export default function SeasonalPicksView({
  id,
  eyebrow,
  title,
  description,
  action,
  items,
}: SeasonalPicksProps) {
  return (
    <Section id={id} aria-labelledby={`${id}-heading`} className="bg-background">
      <div className="flex flex-col gap-6 tablet:flex-row tablet:items-end tablet:justify-between">
        <SectionHeader
          headingId={`${id}-heading`}
          headingLevel={2}
          eyebrow={eyebrow}
          title={title}
          description={description}
          className="max-w-[46rem]"
        />
        <Button asChild variant="link" className="h-auto p-0 text-base font-medium text-primary">
          <ActionLink href={action.href} label={action.label}>
            <span className="inline-flex items-center gap-2">
              {action.label}
              <ArrowRight className="size-4" aria-hidden="true" />
            </span>
          </ActionLink>
        </Button>
      </div>

      <div className="mt-10 grid gap-6 tablet:mt-12 tablet:grid-cols-2 desktop:grid-cols-3 desktop:gap-8">
        {items.map((item) => (
          <article
            key={item.name}
            className="group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-md motion-reduce:hover:translate-y-0"
          >
            <div className="relative overflow-hidden bg-muted">
              <Image
                media={item.image}
                className="aspect-[4/3] size-full object-cover transition duration-500 group-hover:scale-[1.03] motion-reduce:group-hover:scale-100"
              />
              {item.badge ? (
                <span className="absolute left-4 top-4 rounded-full bg-primary px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-primary-foreground">
                  {item.badge}
                </span>
              ) : null}
            </div>
            <div className="flex flex-1 flex-col p-5 tablet:p-6">
              <Heading level={3} variant="title-sm">
                {item.name}
              </Heading>
              <Body size="sm" className="mt-2 flex-1 text-muted-foreground">
                {item.description}
              </Body>
              <p className="mt-4 text-[15px] font-semibold tabular-nums text-primary">
                {item.price}
              </p>
            </div>
          </article>
        ))}
      </div>
    </Section>
  );
}
