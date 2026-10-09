import type {
  SiteDocument,
  TestimonialsGuestsSection,
} from "@/site-schema/generated/types";
import { resolveMedia } from "@/site-schema/runtime/resolve-media";
import TestimonialsGuestsView, {
  type TestimonialsGuestsProps,
} from "./view";

export const toProps = (
  section: TestimonialsGuestsSection,
  site: SiteDocument,
): TestimonialsGuestsProps => {
  void site; // Guest reviews carry no link targets to resolve.
  return {
    id: section.id,
    eyebrow: section.content.eyebrow,
    title: section.content.title,
    description: section.content.description,
    reviews: section.content.reviews.map((review) => ({
      id: review.id,
      quote: review.quote,
      name: review.name,
      detail: review.detail,
      favorite: review.favorite,
      rating: review.rating,
      media: review.media ? resolveMedia(review.media) : undefined,
    })),
  };
};

export default {
  id: "testimonials.guests",
  type: "testimonials",
  variant: "guests",
  toProps,
  render: (section: TestimonialsGuestsSection, site: SiteDocument) => (
    <TestimonialsGuestsView {...toProps(section, site)} />
  ),
} as const;
