import Link from "next/link";
import { Clock, MapPin, Phone } from "lucide-react";

import { Reveal } from "@/templates/b/components/shared/reveal";
import { Section } from "@/templates/b/components/shared/section";
import { SectionHeader } from "@/templates/b/components/shared/section-header";
import { GoogleMap } from "@/templates/b/components/ui/google-map";
import { Image } from "@/templates/b/components/ui/Image";
import type { ResolvedAction } from "@/templates/b/site-schema/runtime/resolve-link";
import type { ResolvedMedia } from "@/templates/b/site-schema/runtime/resolve-media";

export type LocationsStoresStore = {
  id: string;
  name: string;
  addressLines: readonly string[];
  phone: string;
  hoursSummary: string;
  media: ResolvedMedia;
  directions: ResolvedAction;
};

export type LocationsStoresProps = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  map: { query: string; zoom?: number };
  stores: readonly LocationsStoresStore[];
};

const directionsClassName =
  "mt-4 inline-flex items-center gap-2 font-body text-[13px] font-medium text-primary group-hover:underline";

function DirectionsLink({ action }: { action: ResolvedAction }) {
  return action.href.startsWith("/") ? (
    <Link href={action.href} className={directionsClassName}>
      <MapPin aria-hidden="true" className="h-4 w-4" />
      {action.label}
    </Link>
  ) : (
    <a
      href={action.href}
      target="_blank"
      rel="noopener noreferrer"
      className={directionsClassName}
    >
      <MapPin aria-hidden="true" className="h-4 w-4" />
      {action.label}
    </a>
  );
}

export default function LocationsStoresView({
  id,
  eyebrow,
  title,
  description,
  map,
  stores,
}: LocationsStoresProps) {
  const headingId = `${id}-heading`;

  return (
    <Section
      id={id}
      aria-labelledby={headingId}
      spacing="spacious"
      className="scroll-mt-24 desktop:scroll-mt-28"
    >
      <Reveal>
        <SectionHeader
          headingId={headingId}
          headingLevel={2}
          eyebrow={eyebrow}
          title={title}
          description={description}
        />
      </Reveal>
      <div className="mt-12 grid gap-10 desktop:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] desktop:items-stretch">
        <div className="space-y-6">
          {stores.map((store, index) => (
            <Reveal key={store.id} delay={index * 80}>
              <article className="group flex gap-5 rounded-2xl border border-border bg-card p-6 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-md">
                <div className="h-24 w-28 shrink-0 overflow-hidden rounded-xl">
                  <Image
                    media={store.media}
                    className="h-full w-full object-cover"
                  />
                </div>
                <div>
                  <h3 className="font-heading text-[19px] font-semibold">
                    {store.name}
                  </h3>
                  <p className="mt-2 font-body text-sm leading-[1.6] text-muted-foreground">
                    {store.addressLines.map((line, lineIndex) => (
                      <span key={lineIndex} className="block">
                        {line}
                      </span>
                    ))}
                  </p>
                  <ul className="mt-4 space-y-2">
                    <li className="flex items-center gap-2 font-body text-[13px] text-muted-foreground">
                      <Clock aria-hidden="true" className="h-4 w-4 text-primary" />
                      {store.hoursSummary}
                    </li>
                    <li className="flex items-center gap-2 font-body text-[13px] text-muted-foreground">
                      <Phone aria-hidden="true" className="h-4 w-4 text-primary" />
                      {store.phone}
                    </li>
                  </ul>
                  <DirectionsLink action={store.directions} />
                </div>
              </article>
            </Reveal>
          ))}
        </div>
        <div className="overflow-hidden rounded-2xl border border-border shadow-sm">
          <GoogleMap
            mode="place"
            query={map.query}
            zoom={map.zoom ?? 14}
            title="Map of Fern & Grain locations"
            className="h-[320px] w-full tablet:h-[420px] desktop:h-full desktop:min-h-[520px]"
          />
        </div>
      </div>
    </Section>
  );
}
