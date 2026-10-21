import { ArrowRight } from "lucide-react";

import { ActionLink } from "@/templates/a/components/shared/action-link";
import { Section } from "@/templates/a/components/shared/section";
import { Button } from "@/templates/a/components/ui/button";
import { Image } from "@/templates/a/components/ui/Image";
import { Body } from "@/templates/a/components/ui/typography/Body";
import { Heading } from "@/templates/a/components/ui/typography/Heading";
import type { ResolvedAction } from "@/templates/a/site-schema/runtime/resolve-link";
import type { ResolvedMedia } from "@/templates/a/site-schema/runtime/resolve-media";

export type OrderCtaProps = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  image: ResolvedMedia;
  primaryAction: ResolvedAction;
  secondaryAction: ResolvedAction;
};

// The single deep-emerald band on a page; carries one h2 and the ordering actions.
export default function OrderCtaView({
  id,
  eyebrow,
  title,
  description,
  image,
  primaryAction,
  secondaryAction,
}: OrderCtaProps) {
  return (
    <Section
      id={id}
      aria-labelledby={`${id}-heading`}
      spacing="none"
      container="none"
      className="bg-primary text-primary-foreground"
    >
      <div className="container-site grid items-center gap-10 py-16 tablet:py-20 desktop:grid-cols-[1.15fr_1fr] desktop:gap-16 desktop:py-24">
        <div>
          <p className="t-eyebrow text-primary-foreground/70">{eyebrow}</p>
          <Heading
            level={2}
            id={`${id}-heading`}
            variant="title-xl"
            className="mt-4 max-w-[22ch] text-balance text-[32px] leading-[1.15] tablet:text-[44px] desktop:text-[48px]"
          >
            {title}
          </Heading>
          <Body size="lg" className="mt-5 max-w-[52ch] text-primary-foreground/80">
            {description}
          </Body>
          <div className="mt-8 flex flex-col gap-3 tablet:flex-row tablet:items-center">
            <Button
              asChild
              size="lg"
              className="h-12 bg-background px-7 text-[15px] text-primary hover:bg-background/90"
            >
              <ActionLink href={primaryAction.href} label={primaryAction.label}>
                <span className="inline-flex items-center gap-2">
                  {primaryAction.label}
                  <ArrowRight className="size-4" aria-hidden="true" />
                </span>
              </ActionLink>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-12 border-primary-foreground/35 bg-transparent px-7 text-[15px] text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
            >
              <ActionLink href={secondaryAction.href} label={secondaryAction.label} />
            </Button>
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl border border-primary-foreground/15 shadow-sm">
          <Image media={image} className="aspect-[4/3] size-full object-cover desktop:aspect-[5/4]" />
        </div>
      </div>
    </Section>
  );
}
