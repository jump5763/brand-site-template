import { Leaf, Recycle, Sprout } from "lucide-react";

import { ActionLink } from "@/templates/a/components/shared/action-link";
import { Section } from "@/templates/a/components/shared/section";
import { Button } from "@/templates/a/components/ui/button";
import { Image } from "@/templates/a/components/ui/Image";
import { Body } from "@/templates/a/components/ui/typography/Body";
import { Heading } from "@/templates/a/components/ui/typography/Heading";
import type { ResolvedAction } from "@/templates/a/site-schema/runtime/resolve-link";
import type { ResolvedMedia } from "@/templates/a/site-schema/runtime/resolve-media";

export type HeroProps = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  badges: readonly string[];
  image: ResolvedMedia;
  primaryAction: ResolvedAction;
  secondaryAction: ResolvedAction;
};

const badgeIcons = [Sprout, Leaf, Recycle] as const;

// Full-bleed photograph with a warm cream panel; owns the page h1.
export default function HeroView({
  id,
  eyebrow,
  title,
  description,
  badges,
  image,
  primaryAction,
  secondaryAction,
}: HeroProps) {
  return (
    <Section
      id={id}
      aria-labelledby={`${id}-heading`}
      spacing="none"
      container="none"
      className="relative isolate overflow-hidden -mt-[72px] tablet:-mt-[88px]"
    >
      <Image media={image} className="absolute inset-0 -z-10 size-full object-cover" loading="eager" />
      <div className="container-site relative flex min-h-[560px] flex-col justify-center pb-16 pt-[136px] tablet:min-h-[72vh] tablet:pb-24 tablet:pt-[184px] desktop:min-h-[80vh]">
        <div className="w-full max-w-[720px] rounded-2xl border border-border/60 bg-background/95 p-6 shadow-sm backdrop-blur-sm tablet:p-10 desktop:p-12">
          <p className="t-eyebrow text-primary">{eyebrow}</p>
          <Heading
            level={1}
            id={`${id}-heading`}
            variant="display-md"
            className="mt-4 text-balance text-[40px] leading-[1.08] tracking-tight tablet:text-[56px] desktop:text-[64px]"
          >
            {title}
          </Heading>
          <Body size="lg" className="mt-5 max-w-[54ch] text-muted-foreground">
            {description}
          </Body>
          <div className="mt-8 flex flex-col gap-3 tablet:flex-row tablet:items-center">
            <Button asChild size="lg" className="h-12 px-7 text-[15px]">
              <ActionLink href={primaryAction.href} label={primaryAction.label} />
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 px-7 text-[15px]">
              <ActionLink href={secondaryAction.href} label={secondaryAction.label} />
            </Button>
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-3 border-t border-border pt-6">
            {badges.map((badge, index) => {
              const BadgeIcon = badgeIcons[index % badgeIcons.length];
              return (
                <li key={badge} className="flex items-center gap-2 text-sm text-foreground/75">
                  <BadgeIcon aria-hidden="true" className="size-4 text-primary" />
                  {badge}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </Section>
  );
}
