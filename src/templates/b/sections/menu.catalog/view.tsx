"use client";

import { useMemo, useState } from "react";
import { Check } from "lucide-react";

import { Reveal } from "@/templates/b/components/shared/reveal";
import { Section } from "@/templates/b/components/shared/section";
import { Button } from "@/templates/b/components/ui/button";
import { Image } from "@/templates/b/components/ui/Image";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/templates/b/components/ui/select";
import { cn } from "@/templates/b/lib/utils";
import type { ResolvedMedia } from "@/templates/b/site-schema/runtime/resolve-media";

export type MenuCatalogBadge =
  | "Vegan"
  | "Vegetarian"
  | "Gluten-Free"
  | "High Protein"
  | "New";

export type MenuCatalogCategory = {
  id: string;
  label: string;
  description?: string;
};

export type MenuCatalogItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  categoryId: string;
  badges: readonly MenuCatalogBadge[];
  featured?: boolean;
  media: ResolvedMedia;
};

export type MenuCatalogProps = {
  id: string;
  categories: readonly MenuCatalogCategory[];
  items: readonly MenuCatalogItem[];
};

type MenuCatalogSort = "featured" | "price-asc" | "price-desc" | "name-asc";

const filterOrder: readonly MenuCatalogBadge[] = [
  "Vegan",
  "Vegetarian",
  "Gluten-Free",
  "High Protein",
  "New",
];

const categoryTabBase =
  "shrink-0 rounded-full border px-5 py-2.5 font-body text-sm transition-colors";
const filterToggleBase =
  "inline-flex items-center gap-1.5 rounded-full border px-4 py-2 font-body text-[13px] transition-colors";

const priceFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export default function MenuCatalogView({
  id,
  categories,
  items,
}: MenuCatalogProps) {
  const headingId = `${id}-heading`;
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [sort, setSort] = useState<MenuCatalogSort>("featured");

  const availableFilters = useMemo(() => {
    const present = new Set<string>();
    for (const item of items) {
      for (const badge of item.badges) present.add(badge);
    }
    return filterOrder.filter((badge) => present.has(badge));
  }, [items]);

  const visibleItems = useMemo(() => {
    const matching = items.filter(
      (item) =>
        item.categoryId === categoryId &&
        activeFilters.every((filter) => item.badges.some((badge) => badge === filter)),
    );
    const sorted = [...matching];
    if (sort === "price-asc") sorted.sort((a, b) => a.price - b.price);
    else if (sort === "price-desc") sorted.sort((a, b) => b.price - a.price);
    else if (sort === "name-asc") sorted.sort((a, b) => a.name.localeCompare(b.name));
    else
      sorted.sort(
        (a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)),
      );
    return sorted;
  }, [items, categoryId, activeFilters, sort]);

  const activeCategory =
    categories.find((category) => category.id === categoryId) ?? categories[0];
  const dishCount = `${visibleItems.length} ${
    visibleItems.length === 1 ? "dish" : "dishes"
  }`;

  const toggleFilter = (filter: MenuCatalogBadge) =>
    setActiveFilters((current) =>
      current.includes(filter)
        ? current.filter((item) => item !== filter)
        : [...current, filter],
    );

  const clearFilters = () => setActiveFilters([]);

  return (
    <Section id={id} aria-labelledby={headingId} spacing="spacious">
      <Reveal>
        <div
          role="tablist"
          aria-label="Menu categories"
          className="flex gap-2 overflow-x-auto pb-1"
        >
          {categories.map((category) => {
            const selected = category.id === categoryId;
            return (
              <button
                key={category.id}
                type="button"
                role="tab"
                id={`${id}-tab-${category.id}`}
                aria-selected={selected}
                aria-controls={`${id}-panel`}
                onClick={() => setCategoryId(category.id)}
                className={cn(
                  categoryTabBase,
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-foreground/80 hover:border-primary/40 hover:text-primary",
                )}
              >
                {category.label}
              </button>
            );
          })}
        </div>
      </Reveal>

      <Reveal>
        <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
          <p className="w-full font-body text-[12px] uppercase tracking-[0.12em] text-muted-foreground">
            Filters
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {availableFilters.map((filter) => {
              const active = activeFilters.includes(filter);
              return (
                <button
                  key={filter}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleFilter(filter)}
                  className={cn(
                    filterToggleBase,
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-foreground/80 hover:border-primary/40 hover:text-primary",
                  )}
                >
                  {active ? (
                    <Check aria-hidden="true" className="h-3.5 w-3.5" />
                  ) : null}
                  {filter}
                </button>
              );
            })}
            {activeFilters.length > 0 ? (
              <Button
                type="button"
                variant="outline"
                onClick={clearFilters}
                className="h-9 rounded-full px-4"
              >
                Clear filters
              </Button>
            ) : null}
          </div>
          <Select
            value={sort}
            onValueChange={(value) => setSort(value as MenuCatalogSort)}
          >
            <SelectTrigger aria-label="Sort dishes" className="w-[220px] rounded-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="featured">Featured</SelectItem>
              <SelectItem value="price-asc">Price: low to high</SelectItem>
              <SelectItem value="price-desc">Price: high to low</SelectItem>
              <SelectItem value="name-asc">Name: A–Z</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Reveal>

      <div
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${categoryId}`}
        className="mt-10"
      >
        <h2
          id={headingId}
          className="font-heading text-[26px] font-semibold tracking-tight text-foreground tablet:text-[34px]"
        >
          {activeCategory?.label}
        </h2>
        {activeCategory?.description ? (
          <p className="mt-2 max-w-[60ch] font-body text-sm leading-[1.6] text-muted-foreground">
            {activeCategory.description}
          </p>
        ) : null}
        <p className="mt-1 font-body text-[13px] text-muted-foreground">
          {dishCount}
        </p>

        {visibleItems.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-dashed border-border bg-card p-12 text-center">
            <p className="font-body text-sm text-muted-foreground">
              No dishes match these filters.
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={clearFilters}
              className="mt-5 h-10 rounded-full px-6"
            >
              Clear filters
            </Button>
          </div>
        ) : (
          <div className="mt-10 grid gap-8 tablet:grid-cols-2 desktop:grid-cols-3">
            {visibleItems.map((item, index) => {
              const otherBadges = item.badges.filter((badge) => badge !== "New");
              return (
                <Reveal key={item.id} delay={index * 60}>
                  <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-md">
                    <div className="relative overflow-hidden">
                      <Image
                        media={item.media}
                        className="aspect-[4/3] w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                      />
                      {item.badges.some((badge) => badge === "New") ? (
                        <span className="absolute left-4 top-4 rounded-full bg-background/95 px-3 py-1 text-[12px] font-medium text-primary shadow-sm">
                          New
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-1 flex-col p-6">
                      <h3 className="font-heading text-[19px] font-semibold leading-snug text-foreground">
                        {item.name}
                      </h3>
                      <p className="mt-2 font-body text-sm leading-[1.6] text-muted-foreground">
                        {item.description}
                      </p>
                      {otherBadges.length > 0 ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {otherBadges.map((badge) => (
                            <span
                              key={badge}
                              className="rounded-full bg-secondary px-3 py-1 text-[12px] font-medium text-primary"
                            >
                              {badge}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <p className="mt-auto pt-6 font-heading text-[17px] font-semibold text-primary">
                        {priceFormat.format(item.price)}
                      </p>
                    </div>
                  </article>
                </Reveal>
              );
            })}
          </div>
        )}
      </div>
    </Section>
  );
}
