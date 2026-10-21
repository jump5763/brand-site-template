"use client";

import { useEffect, useState } from "react";

import { Section } from "@/components/shared/section";
import { SectionHeader } from "@/components/shared/section-header";
import { Button } from "@/components/ui/button";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel";
import { Image, type BoundImageMedia } from "@/components/ui/Image";

export type MenuSeasonalDish = {
  id: string;
  name: string;
  description: string;
  price: number;
  calories?: number;
  badge?: string;
  tags?: string[];
  media: BoundImageMedia;
};

export type MenuSeasonalProps = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  action: { label: string; href: string };
  dishes: MenuSeasonalDish[];
};

function formatPrice(price: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(price);
}

export default function MenuSeasonalView({
  id,
  eyebrow,
  title,
  description,
  action,
  dishes,
}: MenuSeasonalProps) {
  const headingId = `${id}-heading`;
  const [api, setApi] = useState<CarouselApi>();
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (!api) return;
    const syncSelected = () => setSelectedIndex(api.selectedScrollSnap());
    syncSelected();
    api.on("select", syncSelected);
    api.on("reInit", syncSelected);
    return () => {
      api.off("select", syncSelected);
      api.off("reInit", syncSelected);
    };
  }, [api]);

  const slideCount = api?.scrollSnapList().length ?? dishes.length;

  return (
    <Section
      id={id}
      spacing="standard"
      aria-labelledby={headingId}
      className="bg-background"
    >
      <Carousel
        opts={{ align: "start", loop: true }}
        setApi={setApi}
        aria-labelledby={headingId}
      >
        <div className="flex flex-col gap-8 tablet:flex-row tablet:items-end tablet:justify-between">
          <SectionHeader
            headingId={headingId}
            headingLevel={2}
            title={title}
            eyebrow={eyebrow}
            description={description}
            className="max-w-[42rem]"
          />
          <div className="flex items-center gap-3">
            <Button
              asChild
              variant="outline"
              className="h-11 rounded-full border-border px-6"
            >
              <a href={action.href}>{action.label}</a>
            </Button>
            <CarouselPrevious className="h-11 w-11 border-border bg-background text-foreground hover:bg-accent" />
            <CarouselNext className="h-11 w-11 border-border bg-background text-foreground hover:bg-accent" />
          </div>
        </div>

        <CarouselContent className="mt-10 -ml-6">
          {dishes.map((dish) => (
            <CarouselItem
              key={dish.id}
              aria-label={dish.name}
              className="pl-6 mobile-xs:basis-full tablet:basis-1/2 wide:basis-1/3"
            >
              <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_50px_-30px_hsl(var(--primary)/0.35)] motion-reduce:transition-none motion-reduce:hover:translate-y-0">
                <div className="relative aspect-[4/3] overflow-hidden">
                  <Image
                    media={dish.media}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none"
                  />
                  {dish.badge ? (
                    <span className="absolute left-4 top-4 rounded-full bg-background/95 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                      {dish.badge}
                    </span>
                  ) : null}
                </div>

                <div className="flex flex-1 flex-col p-6">
                  <h3 className="font-heading text-[20px] font-semibold leading-snug text-foreground">
                    {dish.name}
                  </h3>
                  <p className="mt-2 text-[14px] leading-[1.6] text-muted-foreground">
                    {dish.description}
                  </p>

                  {dish.tags && dish.tags.length > 0 ? (
                    <ul className="mt-4 flex flex-wrap gap-2">
                      {dish.tags.map((tag) => (
                        <li
                          key={tag}
                          className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-secondary-foreground"
                        >
                          {tag}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <div className="mt-auto flex items-end justify-between gap-4 border-t border-border pt-4">
                    <p className="font-heading text-[20px] font-semibold text-primary">
                      {formatPrice(dish.price)}
                    </p>
                    {typeof dish.calories === "number" ? (
                      <p className="text-[12px] text-muted-foreground">
                        {dish.calories} cal
                      </p>
                    ) : null}
                  </div>
                </div>
              </article>
            </CarouselItem>
          ))}
        </CarouselContent>

        <div className="mt-8 flex items-center justify-center gap-2">
          {Array.from({ length: slideCount }, (_, index) => (
            <button
              key={index}
              type="button"
              aria-label={`Go to slide ${index + 1}`}
              onClick={() => api?.scrollTo(index)}
              className={
                index === selectedIndex
                  ? "h-1.5 w-6 rounded-full bg-primary"
                  : "h-1.5 w-2 rounded-full bg-border transition-all hover:bg-primary/40 motion-reduce:transition-none"
              }
            />
          ))}
        </div>
      </Carousel>
    </Section>
  );
}
