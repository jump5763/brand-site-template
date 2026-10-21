import { Eyebrow } from "@/components/shared/eyebrow";
import { Section } from "@/components/shared/section";
import { SiteContainer } from "@/components/shared/site-container";
import { Button } from "@/components/ui/button";
import { Image, type BoundImageMedia } from "@/components/ui/Image";
import { Body } from "@/components/ui/typography/Body";
import { Heading } from "@/components/ui/typography/Heading";

export type HomeHeroHighlight = {
  id: string;
  value: string;
  label: string;
};

export type HomeHeroAction = {
  label: string;
  href: string;
};

export type HomeHeroProps = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  media: BoundImageMedia;
  primaryAction: HomeHeroAction;
  secondaryAction: HomeHeroAction;
  highlights: HomeHeroHighlight[];
  scrollHint: string;
};

// This View provides the page h1; everything else here is supporting text.
export default function HomeHeroView({
  id,
  eyebrow,
  title,
  description,
  media,
  primaryAction,
  secondaryAction,
  highlights,
  scrollHint,
}: HomeHeroProps) {
  const headingId = `${id}-heading`;

  return (
    <Section
      id={id}
      spacing="none"
      container="none"
      aria-labelledby={headingId}
      className="relative isolate flex min-h-[88vh] items-center overflow-hidden bg-primary pt-16 tablet:pt-20 wide:min-h-screen"
    >
      <div className="absolute inset-0 -z-10">
        <Image
          media={media}
          className="h-full w-full object-cover animate-soft-zoom motion-reduce:animate-none"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-r from-primary/95 via-primary/80 to-primary/50"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-t from-primary/70 via-transparent to-transparent"
        />
      </div>

      <SiteContainer>
        <div className="flex max-w-[46rem] flex-col items-start py-16 text-primary-foreground tablet:py-24">
          <Eyebrow className="animate-fade-up text-primary-foreground/80 motion-reduce:animate-none">
            {eyebrow}
          </Eyebrow>

          <Heading
            level={1}
            variant="display-lg"
            weight="semibold"
            id={headingId}
            className="mt-5 max-w-[20ch] animate-fade-up text-primary-foreground [animation-delay:100ms] motion-reduce:animate-none"
          >
            {title}
          </Heading>

          <div className="mt-6 max-w-[36rem] animate-fade-up text-primary-foreground/85 [animation-delay:200ms] motion-reduce:animate-none">
            <Body as="p" size="lg">
              {description}
            </Body>
          </div>

          <div className="mt-9 flex animate-fade-up flex-wrap items-center gap-4 [animation-delay:300ms] motion-reduce:animate-none">
            <Button
              asChild
              size="lg"
              className="h-12 rounded-full bg-background px-8 text-primary hover:bg-background/90"
            >
              <a href={primaryAction.href}>{primaryAction.label}</a>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-12 rounded-full border-primary-foreground/40 bg-transparent px-8 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
            >
              <a href={secondaryAction.href}>{secondaryAction.label}</a>
            </Button>
          </div>

          <div className="mt-14 grid w-full max-w-[40rem] animate-fade-up grid-cols-1 gap-6 [animation-delay:400ms] motion-reduce:animate-none tablet:grid-cols-3">
            {highlights.map((highlight) => (
              <div
                key={highlight.id}
                className="border-l border-primary-foreground/25 pl-5"
              >
                <p className="font-heading text-[26px] font-semibold leading-none">
                  {highlight.value}
                </p>
                <p className="mt-2 text-[11px] uppercase tracking-[0.2em] text-primary-foreground/70">
                  {highlight.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </SiteContainer>

      <div
        aria-hidden="true"
        className="absolute bottom-8 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-3 tablet:flex"
      >
        <span className="h-10 w-px bg-primary-foreground/40" />
        <span className="text-[10px] uppercase tracking-[0.3em] text-primary-foreground/70">
          {scrollHint}
        </span>
      </div>
    </Section>
  );
}
