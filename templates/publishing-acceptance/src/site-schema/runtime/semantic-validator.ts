// Compatibility export: all callers now use the same complete validator.
export { validateSiteDocument as validateSiteSemantics } from "./validator.mjs";
export type { SiteDiagnostic, SiteValidationResult } from "./validator.mjs";
