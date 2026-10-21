import { Section } from "@/templates/a/components/shared/section";
import { SectionHeader } from "@/templates/a/components/shared/section-header";
import { Body } from "@/templates/a/components/ui/typography/Body";
import { Heading } from "@/templates/a/components/ui/typography/Heading";
import { MessageForm } from "./message-form";

export type ContactProps = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  channels: readonly { label: string; value: string; href: string; note: string }[];
  form: {
    title: string;
    description: string;
    nameLabel: string;
    namePlaceholder: string;
    emailLabel: string;
    emailPlaceholder: string;
    topicLabel: string;
    topicPlaceholder: string;
    topics: readonly string[];
    messageLabel: string;
    messagePlaceholder: string;
    submitLabel: string;
    successMessage: string;
    privacyNote: string;
  };
};

// Contact channels beside the message form; the h2 covers the block, the card title is an h3.
export default function ContactView({ id, eyebrow, title, description, channels, form }: ContactProps) {
  return (
    <Section id={id} aria-labelledby={`${id}-heading`} className="bg-muted">
      <div className="grid gap-10 desktop:grid-cols-[0.9fr_1.1fr] desktop:gap-16">
        <div>
          <SectionHeader
            headingId={`${id}-heading`}
            headingLevel={2}
            eyebrow={eyebrow}
            title={title}
            description={description}
          />
          <ul className="mt-8 flex flex-col gap-4">
            {channels.map((channel) => (
              <li key={channel.href} className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <p className="t-eyebrow text-muted-foreground">{channel.label}</p>
                <a
                  href={channel.href}
                  className="mt-2 block text-base font-semibold text-primary underline-offset-4 hover:underline"
                >
                  {channel.value}
                </a>
                <p className="mt-1 text-xs text-muted-foreground">{channel.note}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm tablet:p-8">
          <Heading level={3} variant="title-md" className="text-foreground">
            {form.title}
          </Heading>
          <Body size="sm" className="mt-2 text-muted-foreground">
            {form.description}
          </Body>
          <MessageForm
            nameLabel={form.nameLabel}
            namePlaceholder={form.namePlaceholder}
            emailLabel={form.emailLabel}
            emailPlaceholder={form.emailPlaceholder}
            topicLabel={form.topicLabel}
            topicPlaceholder={form.topicPlaceholder}
            topics={form.topics}
            messageLabel={form.messageLabel}
            messagePlaceholder={form.messagePlaceholder}
            submitLabel={form.submitLabel}
            successMessage={form.successMessage}
          />
          <p className="mt-4 text-xs text-muted-foreground">{form.privacyNote}</p>
        </div>
      </div>
    </Section>
  );
}
