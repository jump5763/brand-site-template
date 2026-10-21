"use client";

import { useState } from "react";

import { ActionLink } from "@/templates/a/components/shared/action-link";
import { Section } from "@/templates/a/components/shared/section";
import { SectionHeader } from "@/templates/a/components/shared/section-header";
import { Button } from "@/templates/a/components/ui/button";
import { Label } from "@/templates/a/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/templates/a/components/ui/select";
import { Heading } from "@/templates/a/components/ui/typography/Heading";
import { cn } from "@/templates/a/lib/utils";
import type { ResolvedAction } from "@/templates/a/site-schema/runtime/resolve-link";
import type { ResolvedMedia } from "@/templates/a/site-schema/runtime/resolve-media";
import { DishCard } from "./dish-card";

export type MenuCatalogProps = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  orderAction: ResolvedAction;
  labels: {
    all: string;
    filter: string;
    clear: string;
    sort: string;
    result: string;
    empty: string;
  };
  categories: readonly { id: string; label: string; blurb: string }[];
  filters: readonly { id: string; label: string }[];
  sortOptions: readonly { id: string; label: string }[];
  items: readonly {
    id: string;
    name: string;
    description: string;
    price: number;
    calories: number;
    category: string;
    tags: readonly string[];
    badge?: string;
    featured: boolean;
    image: ResolvedMedia;
  }[];
};

type Dish = MenuCatalogProps["items"][number];

const allCategory = "all";
const chipClass = "shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors duration-300";
const chipActiveClass = "border-primary bg-primary text-primary-foreground";
const chipIdleClass = "border-border bg-card text-foreground/75 hover:border-primary/40 hover:text-primary";

function sortDishes(dishes: readonly Dish[], sort: string): Dish[] {
  const sorted = [...dishes];
  switch (sort) {
    case "price-asc":
      return sorted.sort((a, b) => a.price - b.price);
    case "price-desc":
      return sorted.sort((a, b) => b.price - a.price);
    case "name-asc":
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    default:
      return sorted.sort((a, b) => Number(b.featured) - Number(a.featured));
  }
}

// Filterable menu board: category chips, dietary filters and per-group sorting.
export default function MenuCatalogView({
  id,
  eyebrow,
  title,
  description,
  orderAction,
  labels,
  categories,
  filters,
  sortOptions,
  items,
}: MenuCatalogProps) {
  const [category, setCategory] = useState(allCategory);
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [sort, setSort] = useState(sortOptions[0].id);

  const tagLabels: Record<string, string> = Object.fromEntries(
    filters.map((filter) => [filter.id, filter.label]),
  );

  const visibleItems = items.filter((dish) => {
    const matchesCategory = category === allCategory || dish.category === category;
    const matchesFilters =
      activeFilters.length === 0 || dish.tags.some((tag) => activeFilters.includes(tag));
    return matchesCategory && matchesFilters;
  });

  const groups = categories
    .map((entry) => ({
      entry,
      dishes: sortDishes(
        visibleItems.filter((dish) => dish.category === entry.id),
        sort,
      ),
    }))
    .filter((group) => group.dishes.length > 0);

  const toggleFilter = (filterId: string) => {
    setActiveFilters((current) =>
      current.includes(filterId)
        ? current.filter((entry) => entry !== filterId)
        : [...current, filterId],
    );
  };

  return (
    <Section id={id} aria-labelledby={`${id}-heading`} className="bg-background">
      <div className="flex flex-col gap-6 desktop:flex-row desktop:items-end desktop:justify-between">
        <SectionHeader
          headingId={`${id}-heading`}
          headingLevel={2}
          eyebrow={eyebrow}
          title={title}
          description={description}
          className="max-w-[46rem]"
        />
        <Button asChild size="lg" className="h-12 px-6 text-[15px]">
          <ActionLink href={orderAction.href} label={orderAction.label} />
        </Button>
      </div>

      <div className="mt-8 border-y border-border py-5">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 tablet:mx-0 tablet:flex-wrap tablet:overflow-visible tablet:px-0">
          <button
            type="button"
            aria-pressed={category === allCategory}
            onClick={() => setCategory(allCategory)}
            className={cn(chipClass, category === allCategory ? chipActiveClass : chipIdleClass)}
          >
            {labels.all}
          </button>
          {categories.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={category === entry.id}
              onClick={() => setCategory(entry.id)}
              className={cn(chipClass, category === entry.id ? chipActiveClass : chipIdleClass)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="mt-5 flex flex-col gap-4 tablet:flex-row tablet:items-start tablet:justify-between">
          <div>
            <p className="t-eyebrow text-muted-foreground">{labels.filter}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {filters.map((filter) => {
                const isActive = activeFilters.includes(filter.id);
                return (
                  <button
                    key={filter.id}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => toggleFilter(filter.id)}
                    className={cn(chipClass, isActive ? chipActiveClass : chipIdleClass)}
                  >
                    {filter.label}
                  </button>
                );
              })}
              {activeFilters.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setActiveFilters([])}
                  className="text-xs font-medium text-primary underline underline-offset-4"
                >
                  {labels.clear}
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Label htmlFor={`${id}-sort`} className="text-sm text-muted-foreground">
              {labels.sort}
            </Label>
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger id={`${id}-sort`} className="h-10 w-[210px] bg-card text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sortOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <p role="status" aria-live="polite" className="mt-4 text-sm text-muted-foreground">
          {visibleItems.length} {labels.result}
        </p>
      </div>

      {groups.length > 0 ? (
        groups.map((group) => (
          <div key={group.entry.id} className="mt-12">
            <div className="flex flex-col gap-1 border-b border-border pb-4">
              <Heading level={3} variant="title-lg" className="text-foreground">
                {group.entry.label}
              </Heading>
              <p className="text-sm text-muted-foreground">{group.entry.blurb}</p>
            </div>
            <div className="mt-6 grid gap-6 tablet:grid-cols-2 desktop:grid-cols-3 desktop:gap-8">
              {group.dishes.map((dish) => (
                <DishCard
                  key={dish.id}
                  name={dish.name}
                  description={dish.description}
                  price={dish.price}
                  calories={dish.calories}
                  badge={dish.badge}
                  tags={dish.tags}
                  image={dish.image}
                  tagLabels={tagLabels}
                />
              ))}
            </div>
          </div>
        ))
      ) : (
        <div className="mt-12 rounded-xl border border-dashed border-border bg-muted p-10 text-center">
          <p className="text-sm text-muted-foreground">{labels.empty}</p>
        </div>
      )}
    </Section>
  );
}
