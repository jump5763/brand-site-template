import type { DraftDocument } from "./site-api.mjs";
export function createPreviewDocumentReader<T>(options: {
  templateId: string;
  validate: (value: unknown) => T;
  readDraft?: (merchantId: string, templateId: string) => Promise<DraftDocument>;
  readDemo?: (templateId: string) => Promise<unknown>;
  resolvePreview?: (host: string, pathname: string, baseDomain: string) => { templateId: string; merchantId?: string } | null;
  baseDomain?: string;
}): (host: string) => Promise<T>;
