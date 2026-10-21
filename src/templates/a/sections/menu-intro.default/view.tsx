import { Check } from "lucide-react";

import { Section } from "@/templates/a/components/shared/section";
import { SectionHeader } from "@/templates/a/components/shared/section-header";
import { Image } from "@/templates/a/components/ui/Image";
import type { ResolvedMedia } from "@/templates/a/site-schema/runtime/resolve-media";

export type MenuIntroProps = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  meta: readonly string[];
  image: ResolvedMedia;
};

// The menu page's only h1 lives here; the meta row and the banner carry no headings.
export default function MenuIntroView({
  id,
  eyebrow,
  title,
  description,
  meta,
  image,
}: MenuIntroProps) {
  return (
    <Section id={id} aria-labelledby={`${id}-heading`} spacing="spacious" className="bg-background">
      <SectionHeader
        align="center"
        headingId={`${id}-heading`}
        headingLevel={1}
        eyebrow={eyebrow}
        title={title}
        description={description}
        className="mx-auto max-w-[54rem]"
        descriptionClassName="mx-auto"
        headingClassName="text-[40px] leading-[1.08] tracking-tight tablet:text-[52px] desktop:text-[60px]"
      />

      <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
        {meta.map((entry) => (
          <li key={entry} className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Check className="size-4 text-primary" aria-hidden="true" />
            {entry}
          </li>
        ))}
      </ul>

      <div className="mt-10 overflow-hidden rounded-2xl border border-border shadow-sm tablet:mt-12">
        <Image
          media={image}
          className="aspect-[16/10] size-full object-cover tablet:aspect-[16/7] desktop:aspect-[16/6]"
        />
      </div>
    </Section>
  );
}
