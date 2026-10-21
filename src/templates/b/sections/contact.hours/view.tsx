import Link from "next/link";
import { Mail, Phone, Users } from "lucide-react";

import { Reveal } from "@/templates/b/components/shared/reveal";
import { Section } from "@/templates/b/components/shared/section";
import { SectionHeader } from "@/templates/b/components/shared/section-header";
import { Button } from "@/templates/b/components/ui/button";
import type { ResolvedAction } from "@/templates/b/site-schema/runtime/resolve-link";

export type ContactHoursChannel = {
  id: string;
  channel: "email" | "phone" | "catering";
  label: string;
  value: string;
};

export type ContactHoursEntry = {
  id: string;
  days: string;
  time: string;
};

export type ContactHoursProps = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  hoursLabel?: string;
  hoursNote?: string;
  action?: ResolvedAction;
  channels: readonly ContactHoursChannel[];
  hours: readonly ContactHoursEntry[];
};

const channelIcons = {
  email: Mail,
  phone: Phone,
  catering: Users,
} as const;

export default function ContactHoursView({
  id,
  eyebrow,
  title,
  description,
  hoursLabel,
  hoursNote,
  action,
  channels,
  hours,
}: ContactHoursProps) {
  const headingId = `${id}-heading`;

  return (
    <Section
      id={id}
      aria-labelledby={headingId}
      spacing="spacious"
      className="scroll-mt-24 desktop:scroll-mt-28"
    >
      <div className="mt-0 grid gap-12 desktop:grid-cols-2 desktop:gap-16 desktop:items-start">
        <div>
          <Reveal>
            <SectionHeader
              headingId={headingId}
              headingLevel={2}
              eyebrow={eyebrow}
              title={title}
              description={description}
            />
          </Reveal>
          <div className="mt-10 space-y-6">
            {channels.map((channel) => {
              const ChannelIcon = channelIcons[channel.channel] ?? channelIcons.email;
              return (
                <div key={channel.id} className="flex gap-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
                    <ChannelIcon aria-hidden="true" className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="font-body text-[12px] uppercase tracking-[0.12em] text-muted-foreground">
                      {channel.label}
                    </p>
                    <p className="mt-1 font-body text-[15px] text-foreground">
                      {channel.value}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          {action ? (
            <Button asChild className="mt-10 inline-flex h-12 rounded-full px-7">
              {action.href.startsWith("/") ? (
                <Link href={action.href}>{action.label}</Link>
              ) : (
                <a href={action.href} target="_blank" rel="noopener noreferrer">
                  {action.label}
                </a>
              )}
            </Button>
          ) : null}
        </div>
        <Reveal>
          <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
            {hoursLabel ? (
              <p className="t-eyebrow font-body text-primary">{hoursLabel}</p>
            ) : null}
            <dl className="mt-6 divide-y divide-border">
              {hours.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between gap-4 py-3.5"
                >
                  <dt className="font-body text-sm text-foreground">{entry.days}</dt>
                  <dd className="font-body text-sm text-muted-foreground">
                    {entry.time}
                  </dd>
                </div>
              ))}
            </dl>
            {hoursNote ? (
              <p className="mt-6 font-body text-[13px] leading-[1.6] text-muted-foreground">
                {hoursNote}
              </p>
            ) : null}
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
