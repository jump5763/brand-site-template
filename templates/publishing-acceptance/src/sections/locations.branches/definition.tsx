import type {
  LocationsBranchesSection,
  SiteDocument,
} from "@/site-schema/generated/types";
import LocationsBranchesView, {
  type LocationsBranchesProps,
} from "./view";

export const toProps = (
  section: LocationsBranchesSection,
  site: SiteDocument,
): LocationsBranchesProps => {
  void site; // Branch cards list addresses and hours without link targets.
  return {
    id: section.id,
    eyebrow: section.content.eyebrow,
    title: section.content.title,
    description: section.content.description,
    map: {
      query: section.content.map.query,
      zoom: section.content.map.zoom,
      title: section.content.map.title,
    },
    branches: section.content.branches.map((branch) => ({
      id: branch.id,
      name: branch.name,
      addressLine: branch.addressLine,
      cityLine: branch.cityLine,
      phone: branch.phone,
      hours: [...branch.hours],
      services: [...branch.services],
    })),
    note: section.content.note,
  };
};

export default {
  id: "locations.branches",
  type: "locations",
  variant: "branches",
  toProps,
  render: (section: LocationsBranchesSection, site: SiteDocument) => (
    <LocationsBranchesView {...toProps(section, site)} />
  ),
} as const;
