import type { ContactDefaultSection } from "@/templates/a/site-schema/generated/types";
import ContactView, { type ContactProps } from "./view";

export const toProps = (section: ContactDefaultSection): ContactProps => ({
  id: section.id,
  eyebrow: section.content.eyebrow,
  title: section.content.title,
  description: section.content.description,
  channels: section.content.channels,
  form: section.content.form,
});

export default {
  id: "contact.default",
  type: "contact",
  variant: "default",
  toProps,
  render: (section: ContactDefaultSection) => <ContactView {...toProps(section)} />,
} as const;
