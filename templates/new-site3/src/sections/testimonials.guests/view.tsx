"use client";

import { useState } from "react";

import { Pause, Play, Quote, Star } from "lucide-react";

import { Section } from "@/components/shared/section";
import { SectionHeader } from "@/components/shared/section-header";
import { Button } from "@/components/ui/button";
import { Image, type BoundImageMedia } from "@/components/ui/Image";
import { cn } from "@/lib/utils";

export type TestimonialsGuestsReview = {
  id: string;
  quote: string;
  name: string;
  detail: string;
  favorite?: string;
  rating: number;
  media?: BoundImageMedia;
};

export type TestimonialsGuestsProps = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  reviews: TestimonialsGuestsReview[];
};

const starIndexes = [0, 1, 2, 3, 4];

function ReviewCard({ review }: { review: TestimonialsGuestsReview }) {
  return (
    <div className="mr-6 w-[300px] shrink-0 tablet:w-[340px] desktop:w-[380px]">
      <article
        className="flex h-full flex-col rounded-2xl border border-border bg-card p-7 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_50px_-30px_hsl(var(--primary)/0.35)] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      >
        <Quote aria-hidden="true" className="h-6 w-6 text-primary/30" />

        <div className="mt-5 flex items-center gap-0.5">
          <span className="sr-only">{review.rating} out of 5 stars</span>
          {starIndexes.map((index) => (
            <Star
              key={index}
              aria-hidden="true"
              className={
                index < review.rating
                  ? "h-4 w-4 fill-primary text-primary"
                  : "h-4 w-4 text-border"
              }
            />
          ))}
        </div>

        <blockquote className="mt-4 text-[15px] leading-[1.7] text-foreground">
          {review.quote}
        </blockquote>

        {review.favorite ? (
          <p className="mt-4 text-[12px] uppercase tracking-[0.14em] text-muted-foreground">
            {review.favorite}
          </p>
        ) : null}

        <div className="mt-auto flex items-center gap-3 border-t border-border pt-5">
          {review.media ? (
            <Image
              media={review.media}
              className="h-11 w-11 rounded-full object-cover"
            />
          ) : null}
          <div>
            <p className="text-[14px] font-semibold text-foreground">
              {review.name}
            </p>
            <p className="text-[12px] text-muted-foreground">
              {review.detail}
            </p>
          </div>
        </div>
      </article>
    </div>
  );
}

// One half of the marquee track. The track animates by -50%, so both halves must
// be identical, and each half must stay wider than the widest supported screen:
// one pass of the reviews has to overflow it, or the same review would be
// visible twice at once. Keep at least six reviews in the content.
function ReviewHalf({
  reviews,
  hidden = false,
}: {
  reviews: TestimonialsGuestsReview[];
  hidden?: boolean;
}) {
  return (
    <div aria-hidden={hidden ? "true" : undefined} className="flex shrink-0">
      {reviews.map((review) => (
        <ReviewCard key={review.id} review={review} />
      ))}
    </div>
  );
}

// This View renders one h2 from SectionHeader; guest names and ratings are plain text.
export default function TestimonialsGuestsView({
  id,
  eyebrow,
  title,
  description,
  reviews,
}: TestimonialsGuestsProps) {
  const headingId = `${id}-heading`;
  const [isPaused, setIsPaused] = useState(false);

  return (
    <Section
      id={id}
      spacing="spacious"
      aria-labelledby={headingId}
      className="bg-secondary"
    >
      <div className="mx-auto max-w-[46rem]">
        <SectionHeader
          align="center"
          headingId={headingId}
          headingLevel={2}
          title={title}
          eyebrow={eyebrow}
          description={description}
        />
      </div>

      <div className="group mt-[20px] overflow-hidden py-4 motion-reduce:overflow-x-auto motion-reduce:overflow-y-hidden">
        <div
          className={cn(
            "flex w-max animate-marquee-slow group-hover:[animation-play-state:paused] group-focus-within:[animation-play-state:paused] motion-reduce:animate-none",
            isPaused && "[animation-play-state:paused]",
          )}
        >
          <ReviewHalf reviews={reviews} />
          <ReviewHalf reviews={reviews} hidden />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-center">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setIsPaused((previous) => !previous)}
          className="rounded-full text-muted-foreground hover:bg-accent hover:text-accent-foreground motion-reduce:transition-none"
        >
          {isPaused ? (
            <Play aria-hidden="true" className="h-4 w-4" />
          ) : (
            <Pause aria-hidden="true" className="h-4 w-4" />
          )}
          {isPaused ? "Play reviews" : "Pause reviews"}
        </Button>
      </div>
    </Section>
  );
}
