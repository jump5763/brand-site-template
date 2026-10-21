# Blank Template and Agent Implementation Flow

Status: implemented.
Date: 2026-09-10

This document consolidates the blank-start model and acceptance boundaries agreed for this repository. It describes the target architecture, not the behavior of the current example site. It does not authorize changes to that site by itself.

## 1. Product boundary

The template provides routing, Schema validation/generation, a page renderer, neutral styling defaults, and reusable components under `src/components/ui`. It starts with one empty home Page and zero registered Section implementations.

The Agent creates Pages and data in `src/site-schema/current.json`, designs Section contracts and implementations from user requirements, and assembles the resulting Pages. Header/Footer are designed only when the requirements call for them.

The template does not require a design artifact, Section tree artifact, or a fixed design-to-code compiler pipeline. The Agent may write Page data first, implement a Section first, or alternate between implementation and composition. Standards define responsibilities and acceptance conditions, not file-writing order.

## 2. Initial document

The initial top-level fields are `siteId`, `siteUrl`, `theme`, and `pages`. Remove `layout` entirely from the target contract and initial data; do not replace it with an empty layout object or predeclared header/footer configuration.

The following is a topology example. The checked-in initial document must contain actual valid neutral theme values, with no comments or omitted fields.

```jsonc
{
  "siteId": "untitled-site",
  "siteUrl": "http://localhost:3000",
  "theme": {
    // Complete neutral defaults matching the retained theme contract.
  },
  "pages": [
    {
      "id": "home",
      "path": "/",
      "metadata": {
        "title": "Blank page",
        "description": "",
        "canonicalPath": "/",
        "robots": { "index": false, "follow": false }
      },
      "sections": []
    }
  ]
}
```

- `home` is the initial Page identity, not a mandatory lookup dependency of RootLayout or every subsequent site.
- `siteUrl` is the base for canonical and sitemap URLs. It does not bind the development server's port; set it for the deployment environment before site delivery.
- Neutral theme values are technical defaults, not business facts. Retain only supported tokens and avoid importing sample brand copy, media, addresses, or contact details.
- The starter Page is explicitly noindex/nofollow. New unfinished Pages should use the same policy; publishing requires an intentional SEO decision.
- `current.json` is present in a normal starter checkout. A missing/unreadable or malformed file is a diagnostic condition, not a request to silently reconstruct sample data.

## 3. Runtime behavior

| Condition | Required behavior |
| --- | --- |
| A valid Page exists and its sections array is empty | Render one h1 using that Page's metadata.title; initial output is `<h1>Blank page</h1>` |
| A valid Page has Sections | Render its Section instances in order; do not add the empty-page heading |
| Requested Page does not exist | Use the normal 404 route/state |
| Referenced Section is unknown or its content is invalid | Report the validation/rendering failure; do not skip the Section or render Blank page |
| Document is missing, unreadable, or invalid | Surface the relevant diagnostic without inventing a fallback site |

The empty-page heading belongs to the generic renderer. Do not register a blank Section or create a fixed home route. Preserve the existing catch-all route and Page ID boundary.

Metadata supplies visible heading text only for an empty Page. Once Sections exist, their composition must provide the single meaningful h1. Metadata alone does not repair a populated Page's heading hierarchy. An empty Page's title must therefore be non-empty; an initially empty description is allowed.

Keep `main#main-content`, normal error handling, and minimal accessible document structure. Blank rendering should use deterministic, neutral styling, without unnecessary media, animation, network font downloads, or third-party initialization.

## 4. RootLayout and future Header/Footer

RootLayout owns html/body, global CSS, theme application, the main content boundary, and necessary site-independent infrastructure. It must not depend on a specific Page ID, brand name, locations data, or installed Section type to render a route. Page-specific metadata comes from the selected Page.

The starter contains no business Header/Footer implementation or data. The Agent may later compose them in RootLayout or another appropriate shared Next.js layout. Header/Footer are not automatically ordinary Page Sections, and their development must not create duplicate content routes.

Use shared code and a single suitable content owner when shell content is reused. Do not predefine a replacement shell schema now. If requirements later demand editable shell data or per-Page variations, introduce the smallest explicit contract extension with a clear owner. Cross-page reuse must not require an unrelated business Section merely to boot the site.

Remove unconditional sample-specific integrations, including the current Footer-to-locations adapter and brand title template. Existing reusable UI primitives remain available; optional facilities such as Toaster are composed when needed.

## 5. Empty Registry and contract generation

Zero local Section packages is valid. The generator must accept an empty Section directory and treat a missing Section source directory as empty for a fresh checkout. Unexpected access or malformed-package errors must remain errors.

Generation still emits the normal files: `registry.json`, `capabilities.json`, `site-schema.json`, `types.ts`, and `index.ts`.

- Registry and capability catalog contain zero entries and import no example Definitions.
- The generated Section contract matches no instance, using a valid false schema or equivalent construction. Do not emit invalid `oneOf: []` or loosen Section items to arbitrary objects.
- An empty sections array validates; a non-empty array cannot validate until its capabilities are registered.
- Generated TypeScript represents the empty capability union safely, preferably as `never`. The empty renderer must compile without property access on never or invalid empty unions, and must reject unexpected calls rather than silently succeed.
- The Validator must handle the zero-capability representation explicitly; it cannot assume `section.oneOf` always exists.
- Adding the first real package and regenerating produces the usual typed registry. Removing the last package restores the empty state deterministically.

The existing generator discovers all local packages, including unused ones. Preserve that model; do not add runtime discovery, a second Registry, or a special blank capability.

## 6. Agent flow

These responsibilities may overlap and repeat. They are not approval stages.

| Responsibility | Required outcome |
| --- | --- |
| Understand the request | Page purposes/paths, content sources, main actions, responsive expectations, and material missing facts |
| Design composition | Meaningful Section responsibilities, a heading outline, shell needs, and UI reuse candidates |
| Implement and assemble | Consistent contracts, Definitions, Views, generated output, and Page instance data |
| Verify and refine | Relevant routes, content, appearance, headings, links/media, and interactions meet the request |

Before creating UI, inspect `src/components/ui` and relevant `src/components/shared` implementations and call sites. Reuse matching responsibilities/APIs; otherwise compose a local Section implementation from primitives. On a fresh template, creating Sections is normal work. On subsequent tasks, inspect existing capabilities before adding new ones.

Split Sections by content responsibility, layout composition, independent interaction, and state ownership. A screenshot rectangle, heading, or DOM wrapper alone is not a reason to create a separate Section. Shared state may justify keeping related controls and content together.

| Artifact | Owner |
| --- | --- |
| Page path, metadata, ordered Section instances, content | current.json |
| Section data shape | local contract.schema.json |
| Capability identity and discovery metadata | local section.json |
| Data adaptation, link resolution, View invocation | local definition.tsx |
| Layout, interactions, private helpers | local view.tsx and Section-private files |
| Base UI / established shared presentation | components/ui / components/shared |
| Types, catalog, Registry, composed schema | generator output |

The only enforced ordering is dependency-based: generate before consuming new generated types; implement/register capabilities and supply valid data before claiming their instances previewable; resolve targets before link validation; synchronize code/data/generated artifacts before final acceptance.

The Agent may create Page skeletons directly in current.json and iterate. Intermediate edits may temporarily fail validation. Do not fill missing facts to keep each save green. A draft file is optional when useful, not a required second source of truth or a promotion system.

## 7. Acceptance levels

| Level | Completion conditions |
| --- | --- |
| Template ready | Exact dependencies install; zero-capability generation, validation, types, lint, and production build succeed; no example Section or business shell is required |
| Blank Page previewable | `/` renders one Blank page h1 without runtime/hydration errors; undefined paths return 404; starter noindex metadata is emitted |
| Feature increment previewable | Target Page data validates, referenced capabilities are implemented/registered, generated output is current, and changed content/layout/interactions can be exercised |
| Requested site deliverable | Requested Pages/features are complete; relevant views/states, headings, links/media, and interactions pass; site identity, deployment URL, and SEO policy are intentional; no unexplained placeholders or incomplete required Pages remain |

An empty Page is technically valid and may build successfully. It is incomplete when the request expects content, but acceptable if the user explicitly requested an empty Page. Delivery is judged against requirements, not a universal non-empty-sections build rule. Template defaults are not themselves business-site delivery evidence.

## 8. Intermediate failures and scope

Initially retain one strict full-document Validator shared by CLI and runtime. An invalid Page may prevent other Pages from previewing; document this limitation and show useful diagnostics. Do not silently drop invalid instances or disguise failure as an empty Page.

The Agent controls edit order and chooses checkpoints for restoring a working preview. Per-Page diagnostic isolation can be considered later if simultaneous incomplete Pages become a demonstrated need. This design does not require Draft/Candidate lifecycles, persisted completion flags, generated design trees, or automatic design approval.

## 9. Implementation map

| Current area | Target change |
| --- | --- |
| [Core contract](../src/site-schema/contracts/site-schema.schema.json) | No layout/header/footer fields; initial Page/theme data is strict |
| [Initial content](../src/site-schema/current.json) | Empty home Page with neutral theme defaults |
| [Generator](../scripts/generate-site-schema.mjs) | Supports empty/missing Section sources and emits empty Registry/types safely |
| [Validator](../src/site-schema/runtime/validator.mjs) | Handles zero capabilities and reports unknown instances |
| [Page renderer](../src/site-schema/runtime/render-page.tsx) | Renders the explicit empty-Page h1 branch |
| [RootLayout](../src/app/layout.tsx) | Applies theme and main boundary without business shell dependencies |
| [Link policy](../src/site-schema/runtime/link-policy.mjs) | Supports top and Section instance anchors without sample-specific rules |
| [Metadata](../src/site-schema/runtime/generate-page-metadata.ts), [sitemap](../src/app/sitemap.ts), [robots](../src/app/robots.ts) | Route-owned metadata and noindex behavior use siteUrl |
| Section source directory | Contains no registered capabilities in the starter |
| Agent rules and Skills | Describe the empty-start model, flexible edit order, and acceptance levels |

The migration made empty and populated states coexist before removing the example site and regenerating. This was an implementation strategy, not a mandatory Agent authoring sequence.

## 10. Verification plan

Use meaningful behavioral checks in addition to document review:

1. Empty-directory and missing-directory generation produce equivalent valid outputs; repeated generation is stable.
2. The initial document validates. Unknown instances, invalid content, missing files, and malformed JSON fail explicitly.
3. Empty Registry types compile. Registering one test capability and removing it again exercises both transitions in an isolated fixture.
4. Initial `/` serves one named h1 and no business Header/Footer. A second empty Page displays its own title; missing routes return 404.
5. A populated Page displays its Section heading without the blank fallback. A populated Page lacking h1 is reported at heading acceptance, not repaired by an extra renderer heading.
6. No runtime path requires home by ID or a locations capability. Starter noindex Pages are excluded from sitemap, and canonical URLs use siteUrl.
7. Fresh installation, typecheck, lint, build/start, and browser hydration work. Run typecheck/build serially; keep Webpack/source-tagging behavior unless separately migrated.
8. Confirm all active English instructions describe the new state and contain no compulsory sample content or fixed Page-first/Section-first sequence.

The runtime migration is complete when the verification plan above passes. Future Section work must preserve both empty and populated states.
