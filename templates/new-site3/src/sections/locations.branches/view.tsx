import { Clock } from "lucide-react";

import { Section } from "@/components/shared/section";
import { SectionHeader } from "@/components/shared/section-header";
import { GoogleMap } from "@/components/ui/google-map";

export type LocationsBranchesMap = {
  query: string;
  zoom: number;
  title: string;
};

export type LocationsBranchesBranch = {
  id: string;
  name: string;
  addressLine: string;
  cityLine: string;
  phone: string;
  hours: string[];
  services: string[];
};

export type LocationsBranchesProps = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  map: LocationsBranchesMap;
  branches: LocationsBranchesBranch[];
  note: string;
};

// This View renders one h2 from SectionHeader and one h3 per store name.
export default function LocationsBranchesView({
  id,
  eyebrow,
  title,
  description,
  map,
  branches,
  note,
}: LocationsBranchesProps) {
  const headingId = `${id}-heading`;

  return (
    <Section
      id={id}
      spacing="spacious"
      aria-labelledby={headingId}
      className="scroll-mt-24"
    >
      <SectionHeader
        headingId={headingId}
        headingLevel={2}
        title={title}
        eyebrow={eyebrow}
        description={description}
      />

      <div className="mt-[36px] grid gap-10 desktop:grid-cols-[1.15fr_1fr]">
        <div className="h-[320px] w-full overflow-hidden rounded-2xl border border-border tablet:h-[420px] desktop:h-full desktop:min-h-[520px]">
          <GoogleMap
            mode="place"
            query={map.query}
            zoom={map.zoom}
            title={map.title}
            className="h-full w-full"
          />
        </div>

        <ul className="flex flex-col gap-5">
          {branches.map((branch) => (
            <li
              key={branch.id}
              className="rounded-2xl border border-border bg-card p-6"
            >
              <h3 className="font-heading text-[18px] font-semibold text-foreground">
                {branch.name}
              </h3>

              <div className="mt-3 text-[14px] leading-[1.6] text-muted-foreground">
                <p>{branch.addressLine}</p>
                <p>{branch.cityLine}</p>
              </div>

              <p className="mt-3 text-[14px] font-medium text-foreground">
                {branch.phone}
              </p>

              <ul className="mt-3 flex flex-col gap-1.5">
                {branch.hours.map((line) => (
                  <li
                    key={line}
                    className="flex items-center gap-2 text-[13px] text-muted-foreground"
                  >
                    <Clock aria-hidden="true" className="h-3.5 w-3.5" />
                    {line}
                  </li>
                ))}
              </ul>

              <ul className="mt-4 flex flex-wrap gap-2">
                {branch.services.map((service) => (
                  <li
                    key={service}
                    className="rounded-full bg-secondary px-3 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-secondary-foreground"
                  >
                    {service}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-8 text-[13px] text-muted-foreground">{note}</p>
    </Section>
  );
}
