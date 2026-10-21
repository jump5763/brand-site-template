import { Section } from "@/templates/b/components/shared/section";

export type MenuHeroProps = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  highlights: readonly { id: string; label: string }[];
};

// The menu opener sits above the fold and owns the page h1, so it uses no Reveal.
export default function MenuHeroView({
  id,
  eyebrow,
  title,
  description,
  highlights,
}: MenuHeroProps) {
  const headingId = `${id}-heading`;

  return (
    <Section
      id={id}
      aria-labelledby={headingId}
      spacing="none"
      className="border-b border-border pb-14 pt-[112px] tablet:pb-20 tablet:pt-[148px]"
    >
      <p className="t-eyebrow font-body text-primary">{eyebrow}</p>
      <h1
        id={headingId}
        className="mt-4 font-heading text-[36px] font-semibold leading-[1.1] tracking-tight text-foreground tablet:text-[52px] desktop:text-[60px]"
      >
        {title}
      </h1>
      <p className="mt-5 max-w-[60ch] font-body text-[15px] leading-[1.65] text-muted-foreground tablet:text-[17px]">
        {description}
      </p>
      <ul className="mt-8 flex flex-wrap gap-3">
        {highlights.map((highlight) => (
          <li
            key={highlight.id}
            className="rounded-full border border-border bg-card px-4 py-1.5 font-body text-[13px] text-foreground/80"
          >
            {highlight.label}
          </li>
        ))}
      </ul>
    </Section>
  );
}
