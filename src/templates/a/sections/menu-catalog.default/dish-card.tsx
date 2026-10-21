import { Image } from "@/templates/a/components/ui/Image";
import { Body } from "@/templates/a/components/ui/typography/Body";
import { Heading } from "@/templates/a/components/ui/typography/Heading";
import type { ResolvedMedia } from "@/templates/a/site-schema/runtime/resolve-media";

export type DishCardProps = {
  name: string;
  description: string;
  price: number;
  calories: number;
  badge?: string;
  tags: readonly string[];
  image: ResolvedMedia;
  tagLabels: Record<string, string>;
};

// One dish on the menu board; imported only by the client catalog view.
export function DishCard({
  name,
  description,
  price,
  calories,
  badge,
  tags,
  image,
  tagLabels,
}: DishCardProps) {
  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-md motion-reduce:hover:translate-y-0">
      <div className="relative overflow-hidden bg-muted">
        <Image
          media={image}
          className="aspect-[4/3] size-full object-cover transition duration-500 group-hover:scale-[1.03] motion-reduce:group-hover:scale-100"
        />
        {badge ? (
          <span className="absolute left-4 top-4 rounded-full bg-primary px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-primary-foreground">
            {badge}
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col p-5">
        <Heading level={4} variant="title-sm" className="text-foreground">
          {name}
        </Heading>
        <Body size="sm" className="mt-2 flex-1 text-muted-foreground">
          {description}
        </Body>
        <ul className="mt-4 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <li
              key={tag}
              className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-secondary-foreground"
            >
              {tagLabels[tag] ?? tag}
            </li>
          ))}
        </ul>
        <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
          <p className="text-[15px] font-semibold tabular-nums text-primary">{`$${price.toFixed(2)}`}</p>
          <p className="text-xs text-muted-foreground">{`${calories} cal`}</p>
        </div>
      </div>
    </article>
  );
}
