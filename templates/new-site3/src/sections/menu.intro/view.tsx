import { Eyebrow } from "@/components/shared/eyebrow";
import { Section } from "@/components/shared/section";
import { Image, type BoundImageMedia } from "@/components/ui/Image";
import { Body } from "@/components/ui/typography/Body";
import { Heading } from "@/components/ui/typography/Heading";

export type MenuIntroHighlight = {
  id: string;
  value: string;
  label: string;
};

export type MenuIntroProps = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  media: BoundImageMedia;
  highlights: MenuIntroHighlight[];
  note: string;
};

// This View provides the page h1; no other headings are rendered here.
export default function MenuIntroView({
  id,
  eyebrow,
  title,
  description,
  media,
  highlights,
  note,
}: MenuIntroProps) {
  const headingId = `${id}-heading`;

  return (
    <Section
      id={id}
      spacing="standard"
      aria-labelledby={headingId}
      className="pt-28 tablet:pt-40"
    >
      <div className="grid items-center gap-12 desktop:grid-cols-[1.05fr_1fr] desktop:gap-16">
        <div>
          <Eyebrow className="text-primary">{eyebrow}</Eyebrow>

          <Heading
            level={1}
            variant="display-md"
            weight="semibold"
            id={headingId}
            className="mt-4 max-w-[18ch] text-foreground"
          >
            {title}
          </Heading>

          <div className="mt-6 max-w-[36rem] text-muted-foreground">
            <Body as="p" size="lg">
              {description}
            </Body>
          </div>

          <div className="mt-10 grid max-w-[34rem] grid-cols-1 gap-6 border-t border-border pt-8 tablet:grid-cols-3">
            {highlights.map((highlight) => (
              <div key={highlight.id}>
                <p className="font-heading text-[26px] font-semibold leading-none text-primary">
                  {highlight.value}
                </p>
                <p className="mt-2 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                  {highlight.label}
                </p>
              </div>
            ))}
          </div>

          <p className="mt-6 text-[12px] text-muted-foreground">{note}</p>
        </div>

        <Image
          media={media}
          className="animate-fade-in aspect-[4/3] w-full rounded-3xl object-cover motion-reduce:animate-none"
        />
      </div>
    </Section>
  );
}
