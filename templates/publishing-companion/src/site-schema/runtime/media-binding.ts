import type { SiteDocument, SiteMedia } from "../generated/types";

export const SITE_SCHEMA_DOCUMENT_PATH = "src/site-schema/current.json" as const;

export type SiteMediaBinding = Readonly<{
  version: 1;
  documentPath: typeof SITE_SCHEMA_DOCUMENT_PATH;
  pageId: string;
  sectionId: string;
  contentPath: readonly (string | number)[];
}>;

const bindings = new WeakMap<object, string>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isImageMedia(value: unknown): value is SiteMedia {
  return isRecord(value)
    && value.kind === "image"
    && typeof value.path === "string"
    && typeof value.alt === "string";
}

function visitMedia(
  value: unknown,
  path: readonly (string | number)[],
  bind: (media: SiteMedia, path: readonly (string | number)[]) => void,
): void {
  if (isImageMedia(value)) {
    bind(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visitMedia(entry, [...path, index], bind));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    visitMedia(entry, [...path, key], bind);
  }
}

/** Index validated Site Schema media objects by identity for development-only visual editing. */
export function registerSiteMediaBindings(site: SiteDocument): SiteDocument {
  if (process.env.NODE_ENV === "production") return site;
  const pages = site.pages as readonly Readonly<{
    id: string;
    sections: readonly Readonly<{ id: string; content: unknown }>[];
  }>[];
  for (const page of pages) {
    for (const section of page.sections) {
      visitMedia(section.content, ["content"], (media, contentPath) => {
        const binding: SiteMediaBinding = {
          version: 1,
          documentPath: SITE_SCHEMA_DOCUMENT_PATH,
          pageId: page.id,
          sectionId: section.id,
          contentPath,
        };
        bindings.set(media as object, JSON.stringify(binding));
      });
    }
  }
  return site;
}

export function siteMediaBinding(media: SiteMedia): string | undefined {
  return bindings.get(media as object);
}

/** Client-safe prop helper; it has no filesystem or server-only dependencies. */
export function mediaEditingProps(media: unknown): {
  "data-codeforma-media-ref"?: string;
} {
  if (typeof media !== "object" || media === null) return {};
  const candidate = media as { editRef?: unknown };
  const editRef = typeof candidate.editRef === "string" ? candidate.editRef : bindings.get(media);
  return editRef === undefined ? {} : { "data-codeforma-media-ref": editRef };
}
