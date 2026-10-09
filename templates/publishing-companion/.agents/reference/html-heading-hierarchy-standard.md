# HTML Heading Hierarchy

Required for Page composition and heading-affecting edits. The single-h1, main-first, and no-downward-skip rules are project conventions.

- In normal reading state, `main#main-content` has exactly one meaningful native h1, first among its headings in DOM order.
- An empty Page receives that h1 from the generic renderer using metadata.title. Once Sections exist, the fallback disappears and their composition supplies the h1.
- Page-level groups use h2; nested groups advance one level through h6. Returning upward may skip levels. Equal ranks must express equal content responsibilities.
- Metadata, component names, JSON fields, font sizes, Section/SiteContainer, and native section/article wrappers do not choose or reset heading levels.
- Headings introduce content groups. Labels, descriptions, prices, authors, ratings, and controls do not become headings for visual emphasis.

Record the Page path, h1 provider, Section root levels, and nested levels in existing task notes. The blank starter has no registered capabilities; inspect each installed View before composing it. Display always renders h1; Heading and SectionHeader separate semantic level from appearance; Section and SiteContainer emit no headings.

The composition layer owns the outline. Definition/View passes explicit typed context to components reused at multiple depths. Do not infer levels from pathname, content, index, or style, and do not invent a generic headingLevel field in JSON. When optional parents disappear, recalculate children from their real ancestor; reorganize structures deeper than h6.

- Use instance-derived unique heading IDs and matching aria-labelledby references. aria-label names a region but does not replace required content headings.
- Header/Footer cannot provide the Page h1. Dialog/Sheet portals have their own grouping and should be inspected in open state.
- Determine exposure from the accessibility tree and ancestor state. sr-only usually remains accessible; opacity-zero or off-screen content is not automatically hidden. Responsive alternatives and clones must not expose duplicate hierarchy.
- Check relevant optional-title, empty/filter, responsive, overlay, and error states. Preserve intended typography/layout when changing semantics.

Use the [validation matrix](validation.md). Schema/type/lint/build success and raw heading counts do not prove semantic accessibility. Report the h1 provider, representative outline, tested states, and unavailable checks.

References: [WAI headings](https://www.w3.org/WAI/tutorials/page-structure/headings/), [G141](https://www.w3.org/WAI/WCAG22/Techniques/general/G141.html), [HTML sections](https://html.spec.whatwg.org/dev/sections.html).
