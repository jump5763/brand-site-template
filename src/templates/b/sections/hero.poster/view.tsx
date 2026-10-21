import Link from "next/link";
import { Leaf } from "lucide-react";

import { Section } from "@/templates/b/components/shared/section";
import { SiteContainer } from "@/templates/b/components/shared/site-container";
import { Button } from "@/templates/b/components/ui/button";
import { Image } from "@/templates/b/components/ui/Image";
import type { ResolvedMedia } from "@/templates/b/site-schema/runtime/resolve-media";
import type { ResolvedAction } from "@/templates/b/site-schema/runtime/resolve-link";

export type HeroPosterProps = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  primaryAction: ResolvedAction;
  secondaryAction?: ResolvedAction;
  badges: readonly { id: string; label: string }[];
  media: ResolvedMedia;
};

const filledPill =
  "h-12 rounded-full bg-primary px-7 text-primary-foreground shadow-sm hover:bg-primary/90";
const outlinePill =
  "h-12 rounded-full border border-primary/25 bg-background/70 px-7 text-foreground hover:bg-background";

function ActionButton({ action, className }: { action: ResolvedAction; className: string }) {
  return (
    <Button asChild className={className}>
      {action.href.startsWith("/") ? (
        <Link href={action.href}>{action.label}</Link>
      ) : (
        <a href={action.href} target="_blank" rel="noopener noreferrer">
          {action.label}
        </a>
      )}
    </Button>
  );
}

// The hero owns the page h1 and sits above the fold, so it renders no Reveal wrapper.
export default function HeroPosterView({
  id,
  eyebrow,
  title,
  description,
  primaryAction,
  secondaryAction,
  badges,
  media,
}: HeroPosterProps) {
  const headingId = `${id}-heading`;

  return (
    <Section
      id={id}
      container="none"
      spacing="none"
      className="relative isolate flex min-h-[100svh] items-center overflow-hidden"
    >
      <Image
        media={media}
        className="absolute inset-0 -z-20 h-full w-full object-cover"
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-t from-background via-background/70 to-background/40 tablet:bg-gradient-to-r tablet:from-background tablet:via-background/75 tablet:to-background/10"
      />
      {/* Keeps the transparent fixed header legible without darkening the photograph. */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 -z-10 h-32 bg-gradient-to-b from-background/90 to-transparent"
      />
      <SiteContainer className="relative py-28 tablet:py-36">
        <div className="max-w-[640px]">
          <p className="t-eyebrow font-body text-primary">{eyebrow}</p>
          <h1
            id={headingId}
            className="mt-5 font-heading text-[40px] font-semibold leading-[1.08] tracking-tight text-foreground mobile-xs:text-[34px] tablet:text-[56px] desktop:text-[66px] wide:text-[74px]"
          >
            {title}
          </h1>
          <p className="mt-6 max-w-[52ch] font-body text-[15px] leading-[1.65] text-muted-foreground tablet:text-[17px]">
            {description}
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <ActionButton action={primaryAction} className={filledPill} />
            {secondaryAction ? (
              <ActionButton action={secondaryAction} className={outlinePill} />
            ) : null}
          </div>
          <ul className="mt-10 flex flex-wrap gap-x-7 gap-y-3">
            {badges.map((badge) => (
              <li
                key={badge.id}
                className="flex items-center gap-2 font-body text-[13px] text-foreground/70"
              >
                <Leaf aria-hidden="true" size={16} className="text-primary" />
                {badge.label}
              </li>
            ))}
          </ul>
        </div>
      </SiteContainer>
    </Section>
  );
}
