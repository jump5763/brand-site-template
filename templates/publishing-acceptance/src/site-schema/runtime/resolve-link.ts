import type { SiteAction, SiteDocument } from "../generated/types";
import { linkTargetError } from "./link-policy.mjs";
export interface PageIdentity {
  id: string;
  path: string;
  sections?: readonly { id: string }[];
}
export interface PageAwareDocument {
  pages: readonly PageIdentity[];
}
export interface PageLinkTarget {
  kind: "page";
  pageId: string;
  fragment?: string;
}
export interface ExternalLinkTarget {
  kind: "external";
  href: string;
}
export type LinkTarget =
  | PageLinkTarget
  | ExternalLinkTarget
  | { href: string; kind?: string; newTab?: boolean };

export class LinkResolutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "LinkResolutionError";
  }
}

export function createPageIndex(
  document: PageAwareDocument,
): ReadonlyMap<string, PageIdentity> {
  const index = new Map<string, PageIdentity>();
  for (const page of document.pages ?? []) index.set(page.id, page);
  return index;
}

export function resolvePage(
  document: PageAwareDocument,
  pageId: string,
): PageIdentity {
  const page = createPageIndex(document).get(pageId);
  if (!page)
    throw new LinkResolutionError(
      "LINK_PAGE_UNKNOWN",
      `Unknown page id ${pageId}`,
    );
  return page;
}

export function resolveSection(
  document: PageAwareDocument,
  pageId: string,
  sectionId: string,
) {
  const section = resolvePage(document, pageId).sections?.find(
    (item) => item.id === sectionId,
  );
  if (!section)
    throw new LinkResolutionError(
      "SECTION_UNKNOWN",
      `Unknown section ${sectionId} on page ${pageId}`,
    );
  return section;
}

export function resolveLinkTarget(
  target: LinkTarget,
  document: PageAwareDocument,
): string {
  if (!target || typeof target !== "object")
    throw new LinkResolutionError(
      "LINK_TARGET_INVALID",
      "Link target is required",
    );
  if (target.kind === "page") {
    const pageId = "pageId" in target ? target.pageId : undefined;
    if (typeof pageId !== "string" || !pageId)
      throw new LinkResolutionError(
        "LINK_PAGE_UNKNOWN",
        "Page link requires pageId",
      );
    const error = linkTargetError(document, target);
    if (error) throw new LinkResolutionError("LINK_TARGET_INVALID", error);
    const page = resolvePage(document, pageId);
    const fragment =
      "fragment" in target && typeof target.fragment === "string"
        ? target.fragment
        : undefined;
    return `${page.path}${fragment ? `#${encodeURIComponent(fragment)}` : ""}`;
  }
  const href =
    "href" in target && typeof target.href === "string" ? target.href : "";
  if (!href)
    throw new LinkResolutionError("LINK_HREF_INVALID", "Link href is required");
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  try {
    const url = new URL(href);
    if (url.protocol !== "http:" && url.protocol !== "https:")
      throw new Error("protocol");
    return url.toString();
  } catch {
    throw new LinkResolutionError(
      "LINK_HREF_INVALID",
      `Unsupported href ${href}`,
    );
  }
}

export type ResolvedAction = { label: string; href: string };
export function resolveAction(
  action: SiteAction,
  site: SiteDocument,
): ResolvedAction {
  return { label: action.label, href: resolveLinkTarget(action.target, site) };
}
