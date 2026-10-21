import type { ExampleDefaultSection } from "@/site-schema/generated/types";
import { Section } from "@/components/shared/section";
import { SectionHeader } from "@/components/shared/section-header";

export type ExampleProps = {
  id: string;
  content: ExampleDefaultSection["content"];
};

// This template is a top-level content section below the page's h1.
export default function ExampleView({ id, content }: ExampleProps) {
  const headingId = `${id}-heading`;
  return (
    <Section id={id} aria-labelledby={headingId}>
      <SectionHeader headingId={headingId} headingLevel={2} title={content.title} />
    </Section>
  );
}
