import type { TestimonialsGridSection } from "@/templates/b/site-schema/generated/types";
import { resolveMedia } from "@/templates/b/site-schema/runtime/resolve-media";
import TestimonialsGridView, {
  type TestimonialsGridProps,
} from "./view";

export const toProps = (
  section: TestimonialsGridSection,
): TestimonialsGridProps => ({
  id: section.id,
  eyebrow: section.content.eyebrow,
  title: section.content.title,
  description: section.content.description,
  items: section.content.items.map((item) => ({
    ...item,
    media: resolveMedia(item.media),
  })),
});

export default {
  id: "testimonials.grid",
  type: "testimonials",
  variant: "grid",
  toProps,
  render: (section: TestimonialsGridSection) => (
    <TestimonialsGridView {...toProps(section)} />
  ),
} as const;
