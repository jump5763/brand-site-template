import { Star } from "lucide-react";

import { Reveal } from "@/templates/b/components/shared/reveal";
import { Section } from "@/templates/b/components/shared/section";
import { SectionHeader } from "@/templates/b/components/shared/section-header";
import { Image } from "@/templates/b/components/ui/Image";
import type { ResolvedMedia } from "@/templates/b/site-schema/runtime/resolve-media";

export type TestimonialsGridItem = {
  id: string;
  quote: string;
  author: string;
  role: string;
  rating: number;
  media: ResolvedMedia;
};

export type TestimonialsGridProps = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  items: readonly TestimonialsGridItem[];
};

const ratingScale = [1, 2, 3, 4, 5] as const;

export default function TestimonialsGridView({
  id,
  eyebrow,
  title,
  description,
  items,
}: TestimonialsGridProps) {
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
            <figure className="flex h-full flex-col rounded-2xl border border-border bg-card p-8 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-md">
              <div className="flex items-center gap-1">
                {ratingScale.map((value) => (
                  <Star
                    key={value}
                    aria-hidden="true"
                    className={
                      value <= item.rating
                        ? "h-4 w-4 fill-primary text-primary"
                        : "h-4 w-4 text-border"
                    }
                  />
                ))}
                <span className="sr-only">{`Rated ${item.rating} out of 5`}</span>
              </div>
              <blockquote className="mt-5 font-body text-[15px] leading-[1.7] text-foreground/80">
                {`“${item.quote}”`}
              </blockquote>
              <figcaption className="mt-6 flex items-center gap-4">
                <Image
                  media={item.media}
                  className="h-11 w-11 rounded-full object-cover"
                />
                <div>
                  <p className="font-heading text-[15px] font-semibold text-foreground">
                    {item.author}
                  </p>
                  <p className="mt-0.5 font-body text-[13px] text-muted-foreground">
                    {item.role}
                  </p>
                </div>
              </figcaption>
            </figure>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
