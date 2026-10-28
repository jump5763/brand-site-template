import { createSiteLoader } from "@/load-site";
import { assertValidSiteDocument } from "./site-schema/runtime/validator.mjs";
import type { SiteDocument } from "./site-schema/generated/types";

export const loadSite = createSiteLoader<SiteDocument>("a", assertValidSiteDocument);
