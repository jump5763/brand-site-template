"use client";

import { useMemo, useState } from "react";
import {
  Beef,
  Dumbbell,
  Flame,
  Gauge,
  Leaf,
  MilkOff,
  Sprout,
  Sun,
  Tag,
  WheatOff,
  type LucideIcon,
} from "lucide-react";

import { Section } from "@/components/shared/section";
import { SectionHeader } from "@/components/shared/section-header";
import { Image, type BoundImageMedia } from "@/components/ui/Image";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type MenuCatalogCategory = {
  id: string;
  label: string;
};

export type MenuCatalogSort = {
  id: string;
  label: string;
};

export type MenuCatalogDish = {
  id: string;
  name: string;
  description: string;
  price: number;
  categoryId: string;
  calories?: number;
  badge?: string;
  tags?: string[];
  media: BoundImageMedia;
};

export type MenuCatalogProps = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  allLabel: string;
  categories: MenuCatalogCategory[];
  sorts: MenuCatalogSort[];
  dishes: MenuCatalogDish[];
  resultsLabel: string;
  emptyState: string;
  priceNote: string;
};

const tagIconMap: Record<string, LucideIcon> = {
  Vegan: Leaf,
  Vegetarian: Sprout,
  "Gluten-Free": WheatOff,
  "Dairy-Free": MilkOff,
  "High Protein": Dumbbell,
  Spicy: Flame,
  Paleo: Beef,
  Seasonal: Sun,
  "Low Calorie": Gauge,
};

function formatPrice(price: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(price);
}

export default function MenuCatalogView({
  id,
  eyebrow,
  title,
  description,
  allLabel,
  categories,
  sorts,
  dishes,
  resultsLabel,
  emptyState,
  priceNote,
}: MenuCatalogProps) {
  const headingId = `${id}-heading`;
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [sortId, setSortId] = useState<string>(sorts[0].id);

  const sorted = useMemo(() => {
    const filtered = dishes.filter(
      (dish) => activeCategory === null || dish.categoryId === activeCategory,
    );

    if (sortId === "price-asc") {
      return [...filtered].sort((a, b) => a.price - b.price);
    }
    if (sortId === "price-desc") {
      return [...filtered].sort((a, b) => b.price - a.price);
    }
    if (sortId === "name-asc") {
      return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
    }
    return filtered;
  }, [activeCategory, dishes, sortId]);

  return (
    <Section id={id} spacing="spacious" aria-labelledby={headingId}>
      <div className="flex flex-col gap-8 desktop:flex-row desktop:items-end desktop:justify-between">
        <SectionHeader
          headingId={headingId}
          headingLevel={2}
          title={title}
          eyebrow={eyebrow}
          description={description}
          className="max-w-[42rem]"
        />

        <div className="flex flex-col gap-2 desktop:w-[240px]">
          <Select value={sortId} onValueChange={setSortId}>
            <SelectTrigger
              aria-label="Sort dishes"
              className="h-11 w-full rounded-full border-border bg-background"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sorts.map((sort) => (
                <SelectItem key={sort.id} value={sort.id}>
                  {sort.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div
        role="group"
        aria-label="Filter dishes by category"
        className="mt-10 flex flex-wrap gap-3"
      >
        <button
          type="button"
          aria-pressed={activeCategory === null}
          onClick={() => setActiveCategory(null)}
          className={cn(
            "rounded-full border px-5 py-2.5 text-[13px] font-medium transition-colors motion-reduce:transition-none",
            activeCategory === null
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          {allLabel}
        </button>
        {categories.map((category) => (
          <button
            key={category.id}
            type="button"
            aria-pressed={activeCategory === category.id}
            onClick={() => setActiveCategory(category.id)}
            className={cn(
              "rounded-full border px-5 py-2.5 text-[13px] font-medium transition-colors motion-reduce:transition-none",
              activeCategory === category.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {category.label}
          </button>
        ))}
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <p aria-live="polite" className="text-[13px] text-muted-foreground">
          {sorted.length} {resultsLabel}
        </p>
        <p className="text-[12px] text-muted-foreground">{priceNote}</p>
      </div>

      {sorted.length === 0 ? (
        <p className="mt-10 text-[15px] text-muted-foreground">{emptyState}</p>
      ) : (
        <div className="mt-8 grid gap-6 tablet:grid-cols-2 desktop:grid-cols-3">
          {sorted.map((dish) => {
            const tags = dish.tags ?? [];
            const hasTags = tags.length > 0;
            return (
              <article
                key={dish.id}
                className="group flex h-full animate-in flex-col overflow-hidden rounded-2xl border border-border bg-card fade-in-0 slide-in-from-bottom-2 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_50px_-30px_hsl(var(--primary)/0.35)] motion-reduce:animate-none motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
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
                  {hasTags ? (
                    <ul className="flex flex-wrap gap-2">
                      {tags.map((tag) => {
                        const TagIcon = tagIconMap[tag] ?? Tag;
                        return (
                          <li
                            key={tag}
                            className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.1em] text-secondary-foreground"
                          >
                            <TagIcon aria-hidden="true" className="h-3 w-3" />
                            {tag}
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}

                  <h3
                    className={cn(
                      "font-heading text-[20px] font-semibold leading-snug text-foreground",
                      hasTags ? "mt-4" : undefined,
                    )}
                  >
                    {dish.name}
                  </h3>

                  <p className="mt-2 text-[14px] leading-[1.6] text-muted-foreground">
                    {dish.description}
                  </p>

                  <div className="mt-auto flex items-end justify-between gap-4 border-t border-border pt-5">
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
            );
          })}
        </div>
      )}
    </Section>
  );
}
