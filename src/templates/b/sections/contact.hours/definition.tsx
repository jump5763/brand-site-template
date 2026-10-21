import type {
  ContactHoursSection,
  SiteDocument,
} from "@/templates/b/site-schema/generated/types";
import { resolveAction } from "@/templates/b/site-schema/runtime/resolve-link";
import ContactHoursView, { type ContactHoursProps } from "./view";

export const toProps = (
  section: ContactHoursSection,
  site: SiteDocument,
): ContactHoursProps => ({
  id: section.id,
  eyebrow: section.content.eyebrow,
  title: section.content.title,
  description: section.content.description,
  hoursLabel: section.content.hoursLabel,
  hoursNote: section.content.hoursNote,
  action: section.content.action
    ? resolveAction(section.content.action, site)
    : undefined,
  channels: section.content.channels,
  hours: section.content.hours,
});

export default {
  id: "contact.hours",
  type: "contact",
  variant: "hours",
  toProps,
  render: (section: ContactHoursSection, site: SiteDocument) => (
    <ContactHoursView {...toProps(section, site)} />
  ),
} as const;
