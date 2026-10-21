import { ArrowUpRight, Clock, Phone } from "lucide-react";

import { ActionLink } from "@/templates/a/components/shared/action-link";
import { Section } from "@/templates/a/components/shared/section";
import { SectionHeader } from "@/templates/a/components/shared/section-header";
import { Button } from "@/templates/a/components/ui/button";
import { GoogleMap } from "@/templates/a/components/ui/google-map";
import { Heading } from "@/templates/a/components/ui/typography/Heading";
import type { ResolvedAction } from "@/templates/a/site-schema/runtime/resolve-link";

export type LocationsProps = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  pickupNote: string;
  map: { label: string; query: string; note: string };
  stores: readonly {
    name: string;
    addressLines: readonly string[];
    phone: string;
    hours: readonly { days: string; time: string }[];
    action: ResolvedAction;
  }[];
};

// Kitchen list beside a sticky map; one h2 for the section and one h3 per store.
export default function LocationsView({
  id,
  eyebrow,
  title,
  description,
  pickupNote,
  map,
  stores,
}: LocationsProps) {
  return (
    <Section id={id} aria-labelledby={`${id}-heading`} className="bg-background">
      <SectionHeader
        headingId={`${id}-heading`}
        headingLevel={2}
        eyebrow={eyebrow}
        title={title}
        description={description}
      />
      <p className="mt-5 inline-flex items-center gap-2 rounded-full bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground">
        <Clock className="size-4" aria-hidden="true" />
        {pickupNote}
      </p>

      <div className="mt-10 grid gap-8 desktop:grid-cols-[1.05fr_1fr] desktop:items-start desktop:gap-12">
        <ul className="flex flex-col gap-5">
          {stores.map((store) => (
            <li key={store.name}>
              <article className="rounded-xl border border-border bg-card p-6 shadow-sm">
                <Heading level={3} variant="title-sm" className="text-foreground">
                  {store.name}
                </Heading>
                <address className="mt-2 not-italic">
                  {store.addressLines.map((line) => (
                    <span key={line} className="block text-sm text-muted-foreground">
                      {line}
                    </span>
                  ))}
                </address>
                <p className="mt-2 flex items-center gap-2 text-sm text-foreground/80">
                  <Phone className="size-4 text-primary" aria-hidden="true" />
                  {store.phone}
                </p>
                <dl className="mt-4 space-y-1 border-t border-border pt-4 text-sm">
                  {store.hours.map((row) => (
                    <div key={row.days} className="flex items-baseline justify-between gap-4">
                      <dt className="text-muted-foreground">{row.days}</dt>
                      <dd className="font-medium tabular-nums text-foreground">{row.time}</dd>
                    </div>
                  ))}
                </dl>
                <Button asChild variant="outline" size="sm" className="mt-5">
                  <ActionLink href={store.action.href} label={store.action.label}>
                    <span className="inline-flex items-center gap-2">
                      {store.action.label}
                      <ArrowUpRight className="size-4" aria-hidden="true" />
                    </span>
                  </ActionLink>
                </Button>
              </article>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-3 desktop:sticky desktop:top-[104px]">
          <p className="text-sm font-medium text-foreground">{map.label}</p>
          <div className="overflow-hidden rounded-2xl border border-border bg-muted shadow-sm">
            <GoogleMap
              mode="place"
              query={map.query}
              zoom={14}
              title={map.label}
              className="h-[320px] w-full tablet:h-[420px] desktop:h-[520px]"
            />
          </div>
          <p className="text-xs text-muted-foreground">{map.note}</p>
        </div>
      </div>
    </Section>
  );
}
