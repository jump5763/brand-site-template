// Every page exposes its top marker and registered Section instance anchors.
export function pageAnchors(site, page) {
  const anchors = new Set(["top"]);
  for (const section of page.sections ?? []) anchors.add(section.id);
  return anchors;
}
export function linkTargetError(site, target) {
  if (target.kind !== "page") return null;
  const page = site.pages.find((page) => page.id === target.pageId);
  if (!page) return "Unknown page id";
  if (
    target.fragment !== undefined &&
    (typeof target.fragment !== "string" ||
      !/^[A-Za-z0-9_-]+$/.test(target.fragment) ||
      !pageAnchors(site, page).has(target.fragment))
  )
    return "Unknown or invalid page anchor";
  return null;
}
