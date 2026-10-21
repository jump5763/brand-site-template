import { ChefHat, Sprout, Wheat } from "lucide-react";

import { Section } from "@/templates/a/components/shared/section";
import { SectionHeader } from "@/templates/a/components/shared/section-header";
import { Image } from "@/templates/a/components/ui/Image";
import { Body } from "@/templates/a/components/ui/typography/Body";
import { Heading } from "@/templates/a/components/ui/typography/Heading";
import type { ResolvedMedia } from "@/templates/a/site-schema/runtime/resolve-media";

export type SourcingStoryProps = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  body: string;
  image: ResolvedMedia;
  stats: readonly { value: string; label: string }[];
  practices: readonly { title: string; description: string }[];
};

const practiceIcons = [Sprout, Wheat, ChefHat] as const;

// Sourcing story below the page h1: one h2 for the intro and one h3 per practice.
export default function SourcingStoryView({
  id,
  eyebrow,
  title,
  description,
  body,
  image,
  stats,
  practices,
}: SourcingStoryProps) {
  return (
    <Section id={id} aria-labelledby={`${id}-heading`} className="bg-background">
      <div className="grid gap-10 desktop:grid-cols-2 desktop:items-center desktop:gap-16">
        <div className="relative overflow-hidden rounded-2xl border border-border shadow-sm">
          <Image
            media={image}
            className="aspect-[4/3] size-full object-cover desktop:aspect-[5/4]"
          />
        </div>
        <div>
          <SectionHeader
            headingId={`${id}-heading`}
            headingLevel={2}
            eyebrow={eyebrow}
            title={title}
            description={description}
          />
          <Body className="mt-5 max-w-[56ch] text-muted-foreground">{body}</Body>
        </div>
      </div>

      <div className="mt-12 rounded-2xl bg-secondary px-6 py-8 tablet:px-10 tablet:py-10">
        <ul className="grid gap-6 tablet:grid-cols-3">
          {stats.map((stat) => (
            <li key={stat.label}>
              <p className="font-heading text-[32px] font-semibold leading-none text-primary tablet:text-[40px]">
                {stat.value}
              </p>
              <p className="mt-2 text-sm font-medium text-secondary-foreground/80">{stat.label}</p>
            </li>
          ))}
        </ul>
      </div>

      <ul className="mt-12 grid gap-6 tablet:grid-cols-3">
        {practices.map((practice, index) => {
          const PracticeIcon = practiceIcons[index % practiceIcons.length];
          return (
            <li key={practice.title}>
              <div className="flex size-11 items-center justify-center rounded-full bg-secondary text-primary">
                <PracticeIcon className="size-5" aria-hidden="true" />
              </div>
              <Heading level={3} variant="title-sm" className="mt-4 text-foreground">
                {practice.title}
              </Heading>
              <Body size="sm" className="mt-2 text-muted-foreground">
                {practice.description}
              </Body>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
