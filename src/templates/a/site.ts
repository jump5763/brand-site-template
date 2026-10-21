import { createSiteLoader } from "@/load-site";
import { assertValidSiteDocument } from "./site-schema/runtime/validator.mjs";

export const loadSite = createSiteLoader("a", assertValidSiteDocument);
