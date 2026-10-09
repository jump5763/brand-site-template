# Site Content Contract

The editable document is [current.json](../../src/site-schema/current.json). Supported fields come from the [core contract](../../src/site-schema/contracts/site-schema.schema.json) and each installed Section's local contract. For a new site, follow [Bootstrap current.json](../skills/compose-page/references/bootstrap-current-json.md).

| Change | Location |
| --- | --- |
| Page identity/path/metadata | `pages[]` |
| Section order and instance data | `pages[].sections[]` |
| Fonts and semantic colors | `theme` |

- Preserve the top-level `siteId`, `siteUrl`, `theme`, and `pages` shape. Header/Footer are designed when required and do not justify undeclared top-level fields.
- A capability ID is descriptor `type.variant`; a Page Section instance has its own Page-unique ID. Preserve identities for content-only edits.
- Paths are normalized and site-unique. Content Pages use [the catch-all route](../../src/app/[[...slug]]/page.tsx); do not create fixed content routes or duplicate View defaults.
- Metadata requires title, description, and canonicalPath. Canonical path equals Page path. The empty-Page renderer uses title as its h1; a populated Page obtains headings from Sections.
- Internal actions use `{kind: "page", pageId, fragment?}`. [Link policy](../../src/site-schema/runtime/link-policy.mjs) permits `top` and Section instance IDs. A DOM heading ID is not automatically a Schema link target.
- Current media objects are images with kind/path/alt. `/media/...` resolves inside public/media; remote images require credential-free HTTP(S) URLs. URL validity does not prove availability.
- Site Schema images remain owned by `current.json`. Resolve them with `resolveMedia` and render them exclusively through `@/components/ui/Image` using its `media` prop. Never use native `<img>`, `next/image`, CSS background images, another image wrapper, or a resolved URL copied into Section source.
- Do not serialize registries, runtime indexes, executable paths/functions, arbitrary styling, or component props. Domain consistency rules belong to the owning Section contract/adapter.
- `metadata.robots.index: false` excludes a Page from sitemap. siteUrl supplies canonical and sitemap bases and must be intentional before delivery.

[schema:generate](../../scripts/generate-site-schema.mjs) scans all local Section packages and supports zero capabilities. Never hand-edit generated output or create another Registry. Apply the [validation matrix](validation.md); composition and headings also follow the [heading standard](html-heading-hierarchy-standard.md).
