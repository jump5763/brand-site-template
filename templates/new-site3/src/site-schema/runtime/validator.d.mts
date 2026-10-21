import type { ErrorObject } from "ajv";
import type { SiteDocument } from "../generated/types";
export interface SiteDiagnostic {
  ruleId: string;
  pointer: string;
  message: string;
}
export type SiteValidationResult =
  | { valid: true; value: SiteDocument; errors: SiteDiagnostic[] }
  | { valid: false; value?: undefined; errors: SiteDiagnostic[] };
export class SiteValidationError extends Error {
  diagnostics: SiteDiagnostic[];
  constructor(diagnostics: SiteDiagnostic[]);
}
export function parseSiteJson(text: string): unknown;
export function validateSiteCore(value: unknown): {
  valid: boolean;
  errors: ErrorObject[];
};
export function createSiteValidator(
  schema: object,
): (value: unknown) => SiteValidationResult;
export function validateSiteDocument(value: unknown): SiteValidationResult;
export function assertValidSiteDocument(value: unknown): SiteDocument;
