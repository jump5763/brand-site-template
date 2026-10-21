import {
  Droplet,
  HeartHandshake,
  Leaf,
  Recycle,
  Sprout,
  Sun,
  Truck,
  Wheat,
  type LucideIcon,
} from "lucide-react";

import { Section } from "@/components/shared/section";
import { SectionHeader } from "@/components/shared/section-header";
import { Image, type BoundImageMedia } from "@/components/ui/Image";

export type IngredientsFreshItem = {
  id: string;
  title: string;
  description: string;
  icon: string;
  media: BoundImageMedia;
};

export type IngredientsFreshProps = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  items: IngredientsFreshItem[];
  note: string;
};

const iconMap: Record<string, LucideIcon | undefined> = {
  leaf: Leaf,
  sprout: Sprout,
  wheat: Wheat,
  sun: Sun,
  droplet: Droplet,
  heart: HeartHandshake,
  truck: Truck,
  recycle: Recycle,
};

export default function IngredientsFreshView({
  id,
  eyebrow,
  title,
  description,
  items,
  note,
}: IngredientsFreshProps) {
  const headingId = `${id}-heading`;

  return (
    <Section id={id} spacing="standard" aria-labelledby={headingId}>
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

      <div className="mt-[36px] grid gap-6 tablet:grid-cols-2 desktop:grid-cols-4">
        {items.map((item) => {
          const Icon = iconMap[item.icon] ?? Leaf;
          return (
            <article
              key={item.id}
              className="group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_50px_-30px_hsl(var(--primary)/0.35)] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              <div className="relative aspect-[5/4] overflow-hidden">
                <Image
                  media={item.media}
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none"
                />
                <span className="absolute bottom-4 left-4 inline-flex h-11 w-11 items-center justify-center rounded-full bg-background text-primary shadow-sm">
                  <Icon aria-hidden="true" className="h-5 w-5" />
                </span>
              </div>

              <div className="flex flex-1 flex-col p-6">
                <h3 className="font-heading text-[18px] font-semibold text-foreground">
                  {item.title}
                </h3>
                <p className="mt-2 text-[14px] leading-[1.6] text-muted-foreground">
                  {item.description}
                </p>
              </div>
            </article>
          );
        })}
      </div>

      <p className="mt-10 text-center text-[13px] text-muted-foreground">
        {note}
      </p>
    </Section>
  );
}
