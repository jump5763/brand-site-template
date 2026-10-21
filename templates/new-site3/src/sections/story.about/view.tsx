import { Section } from "@/components/shared/section";
import { SectionHeader } from "@/components/shared/section-header";
import { Button } from "@/components/ui/button";
import { Image, type BoundImageMedia } from "@/components/ui/Image";
import { Body } from "@/components/ui/typography/Body";

export type StoryAboutStat = {
  id: string;
  value: string;
  label: string;
};

export type StoryAboutAction = {
  label: string;
  href: string;
};

export type StoryAboutProps = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  body: string[];
  media: BoundImageMedia;
  secondaryMedia: BoundImageMedia;
  stats: StoryAboutStat[];
  action: StoryAboutAction;
};

// This View renders one h2 from SectionHeader; stats and paragraphs are not headings.
export default function StoryAboutView({
  id,
  eyebrow,
  title,
  description,
  body,
  media,
  secondaryMedia,
  stats,
  action,
}: StoryAboutProps) {
  const headingId = `${id}-heading`;

  return (
    <Section
      id={id}
      spacing="spacious"
      aria-labelledby={headingId}
      className="scroll-mt-24"
    >
      <div className="grid items-center gap-12 desktop:grid-cols-2 desktop:gap-16">
        <div className="relative pb-8 tablet:pb-0">
          <Image
            media={media}
            className="relative z-0 aspect-[4/5] w-full rounded-3xl object-cover"
          />
          <Image
            media={secondaryMedia}
            className="absolute -bottom-8 -right-4 hidden aspect-square w-[46%] rounded-3xl border-4 border-background object-cover shadow-lg tablet:block"
          />
        </div>

        <div>
          <SectionHeader
            headingId={headingId}
            headingLevel={2}
            title={title}
            eyebrow={eyebrow}
            description={description}
          />

          <div className="mt-6 flex flex-col gap-4 text-muted-foreground">
            {body.map((paragraph, index) => (
              <Body key={index} as="p" size="md">
                {paragraph}
              </Body>
            ))}
          </div>

          <div className="mt-10 grid grid-cols-1 gap-6 border-y border-border py-8 tablet:grid-cols-3">
            {stats.map((stat) => (
              <div key={stat.id}>
                <p className="font-heading text-[28px] font-semibold text-primary">
                  {stat.value}
                </p>
                <p className="mt-1 text-[12px] uppercase tracking-[0.18em] text-muted-foreground">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>

          <Button
            asChild
            size="lg"
            className="mt-10 h-12 rounded-full px-8 motion-reduce:transition-none"
          >
            <a href={action.href}>{action.label}</a>
          </Button>
        </div>
      </div>
    </Section>
  );
}
