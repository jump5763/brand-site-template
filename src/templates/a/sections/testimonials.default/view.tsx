import { Star } from "lucide-react";

import { Section } from "@/templates/a/components/shared/section";
import { SectionHeader } from "@/templates/a/components/shared/section-header";
import { Body } from "@/templates/a/components/ui/typography/Body";
import { cn } from "@/templates/a/lib/utils";

export type TestimonialsProps = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  items: readonly { quote: string; author: string; meta: string; rating: number }[];
};

const starCount = 5;

// Guest reviews on a soft cream band; the only heading is the section h2.
export default function TestimonialsView({
  id,
  eyebrow,
  title,
  description,
  items,
}: TestimonialsProps) {
  return (
    <Section id={id} aria-labelledby={`${id}-heading`} className="bg-muted">
      <SectionHeader
        align="center"
        headingId={`${id}-heading`}
        headingLevel={2}
        eyebrow={eyebrow}
        title={title}
        description={description}
        className="mx-auto max-w-[46rem]"
        descriptionClassName="mx-auto"
      />

      <div className="mt-10 grid gap-6 tablet:grid-cols-2 desktop:grid-cols-3 desktop:gap-8">
        {items.map((item) => (
          <figure
            key={item.author}
            className="flex h-full flex-col rounded-xl border border-border bg-card p-6 shadow-sm"
          >
            <div
              role="img"
              aria-label={`${item.rating} out of 5 stars`}
              className="flex items-center gap-1 text-primary"
            >
              {Array.from({ length: starCount }, (_, index) => (
                <Star
                  key={index}
                  aria-hidden="true"
                  className={cn("size-4", index < item.rating ? "fill-current" : "text-border")}
                />
              ))}
            </div>
            <blockquote className="mt-4 flex-1">
              <Body as="p" size="md" className="text-foreground/85">
                {`“${item.quote}”`}
              </Body>
            </blockquote>
            <figcaption className="mt-5 border-t border-border pt-4">
              <span className="block text-sm font-semibold text-foreground">{item.author}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{item.meta}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </Section>
  );
}
