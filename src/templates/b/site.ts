import { createSiteLoader } from "@/load-site";
import type { SiteDocument } from "./site-schema/generated/types";

export const loadSite = createSiteLoader<SiteDocument>("b");
