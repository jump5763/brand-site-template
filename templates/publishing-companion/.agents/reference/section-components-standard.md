# Shared Section Components

For Section presentation work. These are React helpers, not registered Schema capabilities; their props do not become JSON fields. Follow [heading](html-heading-hierarchy-standard.md) and [styling](tailwind-css-best-practices.md) rules when applicable.

| Helper | Responsibility | Source |
| --- | --- | --- |
| Section | Native section, vertical spacing, optional container; no title inference | [section.tsx](../../src/components/shared/section.tsx) |
| SiteContainer | Native div, site width and gutters | [site-container.tsx](../../src/components/shared/site-container.tsx) |
| SectionHeader | Independently placed title group and Body description | [section-header.tsx](../../src/components/shared/section-header.tsx) |
| Eyebrow | Introductory paragraph, not a heading | [eyebrow.tsx](../../src/components/shared/eyebrow.tsx) |
| Body | Body font, size, line height, weight | [Body.tsx](../../src/components/ui/typography/Body.tsx) |
| Image | Exclusive renderer for Site Schema and UI images; preserves editing bindings and CDN resolution | [Image.tsx](../../src/components/ui/Image.tsx) |

## Container API

- Prefer Section for semantic groups; use div/SiteContainer for ordinary layout. Pass the instance ID. Native aria/data/style attributes pass through; events still require a valid client boundary.
- `spacing="standard"` defaults to 64px vertical padding, 96px from 769px; spacious is 72px/104px; none is zero. Values use `--section-space-y` and `--section-space-y-spacious` in [globals.css](../../src/app/globals.css).
- Prefer spacing choices over repeated `!py-*`. Unique/asymmetric spacing can use none plus static utilities. Outer className/style applies to section.
- Default `container="site"` wraps children once; containerClassName styles that wrapper. `container="none"` renders children directly and ignores containerClassName. Avoid duplicate containers/gutters.
- SiteContainer uses `.container-site`: max width 1760px, gutters 16px/40px at 769px. Reuse it for matching shell or multi-part layouts.
- Cards, media, backgrounds, grids, and actions remain in View. Use implemented props, not another project's SectionFrame API.
- Render every image through Image. Use `media` for resolved Site Schema media and `src`/`alt` only for non-Schema assets; do not use native `<img>`, `next/image`, CSS background images, or another wrapper.

## Title API

- Place SectionHeader inside the appropriate column, card, or action row. Title and headingId are required; headingLevel defaults to 2. The caller owns root/child semantics; headingClassName controls appearance, defaulting to the `.t-h2` look.
- Derive headingId from the instance ID and explicitly connect Section's aria-labelledby. Neither helper connects them automatically.
- Optional eyebrow/description are omitted when absent. descriptionSize accepts BodySize, default md: 14px/1.5, then 16px/1.6 from 769px. Use descriptionClassName for spacing, width, and color instead of repeating typography scales.
- font-body/font-sans share the theme typography font. Extend Body compatibly for repeated new scales. Import standalone Eyebrow directly.
- Helpers must not read routes/current.json/Registry or Section-private code. Do not add hooks/client boundaries just for prop forwarding. Keep valid custom markup when these helpers do not fit.

```tsx
import { Section } from "@/components/shared/section";
import { SectionHeader } from "@/components/shared/section-header";

<Section id={id} aria-labelledby={`${id}-heading`}>
  <SectionHeader headingId={`${id}-heading`} headingLevel={2}
    title={title} description={description} descriptionSize="md" />
  <div className="mt-[36px]">{children}</div>
</Section>
```

This example belongs below the Page h1. Check affected consumers with the [validation matrix](validation.md).
