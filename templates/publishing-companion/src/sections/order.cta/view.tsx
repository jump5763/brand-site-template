import { Check } from "lucide-react";

import { Eyebrow } from "@/components/shared/eyebrow";
import { Section } from "@/components/shared/section";
import { SectionHeader } from "@/components/shared/section-header";
import { Button } from "@/components/ui/button";

export type OrderCtaAction = {
  label: string;
  href: string;
};

export type OrderCtaProps = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  primaryAction: OrderCtaAction;
  secondaryAction: OrderCtaAction;
  perks: string[];
  note: string;
};

// The eyebrow is rendered here so it can use the inverted panel colour.
// SectionHeader receives no eyebrow, so the h2 is the only heading in this View.
export default function OrderCtaView({
  id,
  eyebrow,
  title,
  description,
  primaryAction,
  secondaryAction,
  perks,
  note,
}: OrderCtaProps) {
  const headingId = `${id}-heading`;

  return (
    <Section
      id={id}
      spacing="standard"
      aria-labelledby={headingId}
      className="scroll-mt-24"
    >
      <div className="overflow-hidden rounded-3xl bg-primary px-6 py-14 text-primary-foreground tablet:px-14 tablet:py-20">
        <div className="mx-auto flex max-w-[46rem] flex-col items-center text-center">
          <Eyebrow className="text-primary-foreground/80">{eyebrow}</Eyebrow>

          <SectionHeader
            className="mt-3"
            align="center"
            headingId={headingId}
            headingLevel={2}
            title={title}
            description={description}
            headingClassName="text-primary-foreground"
            descriptionClassName="text-primary-foreground/80"
          />

          <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
            <Button
              asChild
              size="lg"
              className="h-12 rounded-full bg-background px-8 text-primary hover:bg-background/90 motion-reduce:transition-none"
            >
              <a href={primaryAction.href}>{primaryAction.label}</a>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-12 rounded-full border-primary-foreground/40 bg-transparent px-8 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground motion-reduce:transition-none"
            >
              <a href={secondaryAction.href}>{secondaryAction.label}</a>
            </Button>
          </div>

          <ul className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
            {perks.map((perk) => (
              <li
                key={perk}
                className="inline-flex items-center gap-2 text-[13px] text-primary-foreground/85"
              >
                <Check
                  aria-hidden="true"
                  className="h-4 w-4 text-primary-foreground"
                />
                {perk}
              </li>
            ))}
          </ul>

          <p className="mt-8 text-[12px] text-primary-foreground/60">{note}</p>
        </div>
      </div>
    </Section>
  );
}
