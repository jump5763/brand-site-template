import type { TestimonialsDefaultSection } from "@/templates/a/site-schema/generated/types";
import TestimonialsView, { type TestimonialsProps } from "./view";

export const toProps = (section: TestimonialsDefaultSection): TestimonialsProps => ({
  id: section.id,
  eyebrow: section.content.eyebrow,
  title: section.content.title,
  description: section.content.description,
  items: section.content.items,
});

export default {
  id: "testimonials.default",
  type: "testimonials",
  variant: "default",
  toProps,
  render: (section: TestimonialsDefaultSection) => (
    <TestimonialsView {...toProps(section)} />
  ),
} as const;
