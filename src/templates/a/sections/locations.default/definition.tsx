import type { LocationsDefaultSection, SiteDocument } from "@/templates/a/site-schema/generated/types";
import { resolveAction } from "@/templates/a/site-schema/runtime/resolve-link";
import LocationsView, { type LocationsProps } from "./view";

export const toProps = (section: LocationsDefaultSection, site: SiteDocument): LocationsProps => ({
  id: section.id,
  eyebrow: section.content.eyebrow,
  title: section.content.title,
  description: section.content.description,
  pickupNote: section.content.pickupNote,
  map: section.content.map,
  stores: section.content.stores.map((store) => ({
    name: store.name,
    addressLines: store.addressLines,
    phone: store.phone,
    hours: store.hours,
    action: resolveAction(store.action, site),
  })),
});

export default {
  id: "locations.default",
  type: "locations",
  variant: "default",
  toProps,
  render: (section: LocationsDefaultSection, site: SiteDocument) => (
    <LocationsView {...toProps(section, site)} />
  ),
} as const;
