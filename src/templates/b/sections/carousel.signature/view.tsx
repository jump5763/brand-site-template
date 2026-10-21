"use client";

import { useState } from "react";
import Link from "next/link";
import Autoplay from "embla-carousel-autoplay";
import { ArrowRight } from "lucide-react";

import { Reveal } from "@/templates/b/components/shared/reveal";
import { Section } from "@/templates/b/components/shared/section";
import { SectionHeader } from "@/templates/b/components/shared/section-header";
import { Button } from "@/templates/b/components/ui/button";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/templates/b/components/ui/carousel";
import { Image } from "@/templates/b/components/ui/Image";
import type { ResolvedMedia } from "@/templates/b/site-schema/runtime/resolve-media";
import type { ResolvedAction } from "@/templates/b/site-schema/runtime/resolve-link";

export type CarouselSignatureItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  tag?: string;
  media: ResolvedMedia;
};

export type CarouselSignatureProps = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  action?: ResolvedAction;
  items: readonly CarouselSignatureItem[];
};

const priceFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export default function CarouselSignatureView({
  id,
  eyebrow,
  title,
  description,
  action,
  items,
}: CarouselSignatureProps) {
  const [plugins] = useState(() => [
    Autoplay({ delay: 4500, stopOnMouseEnter: true, stopOnInteraction: false }),
  ]);
  const headingId = `${id}-heading`;

  return (
    <Section id={id} aria-labelledby={headingId} spacing="spacious">
      <Reveal>
        <SectionHeader
          headingId={headingId}
          headingLevel={2}
          eyebrow={eyebrow}
          title={title}
          description={description}
        />
      </Reveal>
      <div className="mt-12">
        <Carousel
          opts={{ align: "start", loop: true }}
          plugins={plugins}
        >
          <CarouselContent className="-ml-6">
            {items.map((item, index) => (
              <CarouselItem
                key={item.id}
                aria-label={`${index + 1} of ${items.length}`}
                className="pl-6 tablet:basis-1/2 desktop:basis-1/3"
              >
                <Reveal delay={index * 80} className="h-full">
                  <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-md">
                    <div className="overflow-hidden">
                      <Image
                        media={item.media}
                        className="aspect-[4/3] h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                      />
                    </div>
                    <div className="flex flex-1 flex-col p-6">
                      {item.tag ? (
                        <span className="inline-flex w-fit rounded-full bg-secondary px-3 py-1 text-[12px] font-medium text-primary">
                          {item.tag}
                        </span>
                      ) : null}
                      <h3 className="mt-3 font-heading text-[20px] font-semibold leading-snug text-foreground tablet:text-[22px]">
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
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious className="absolute left-3 top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 border-border bg-background/90 text-foreground shadow-sm hover:bg-background tablet:inline-flex" />
          <CarouselNext className="absolute right-3 top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 border-border bg-background/90 text-foreground shadow-sm hover:bg-background tablet:inline-flex" />
        </Carousel>
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
