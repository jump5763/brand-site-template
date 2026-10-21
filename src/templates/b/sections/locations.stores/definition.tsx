import type {
  LocationsStoresSection,
  SiteDocument,
} from "@/templates/b/site-schema/generated/types";
import { resolveAction } from "@/templates/b/site-schema/runtime/resolve-link";
import { resolveMedia } from "@/templates/b/site-schema/runtime/resolve-media";
import LocationsStoresView, {
  type LocationsStoresProps,
} from "./view";

export const toProps = (
  section: LocationsStoresSection,
  site: SiteDocument,
): LocationsStoresProps => ({
  id: section.id,
  eyebrow: section.content.eyebrow,
  title: section.content.title,
  description: section.content.description,
  map: section.content.map,
  stores: section.content.stores.map((store) => ({
    ...store,
    media: resolveMedia(store.media),
    directions: resolveAction(store.directions, site),
  })),
});

export default {
  id: "locations.stores",
  type: "locations",
  variant: "stores",
  toProps,
  render: (section: LocationsStoresSection, site: SiteDocument) => (
    <LocationsStoresView {...toProps(section, site)} />
  ),
} as const;
