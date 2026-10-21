# Project Styling

Read for JSX classes, typography, theme, or layout changes. Authorities: [Tailwind config](../../tailwind.config.ts), [shared CSS](../../src/app/globals.css), and [theme adapter](../../src/site-schema/runtime/apply-theme.tsx).

## Theme and typography

- Rendering follows Schema theme -> themeToCssVariables -> CSS variables -> configured utilities. UI helpers consume props/tokens; route/runtime orchestration may read Schema.
- Use declared semantic colors. Theme-dependent colors must not become fixed copied brand colors.
- font-body/font-sans share the typography font; font-display/font-serif use the configured heading font. Some primitives contain unmapped font-heading: check effective styling rather than assuming that alias works.
- Use Body for reusable body scales and SectionHeader.descriptionSize for descriptions. Keep layout/color overrides separate; repeated new scales belong in compatible shared variants.
- Semantic levels follow the [heading rules](html-heading-hierarchy-standard.md), not font size. Custom Hero/editorial sizes may remain when presets do not fit.

## Breakpoints and layout

Base utilities apply at every width unless overridden. The config retains default screens, including sm/md, and adds:

| Site variant | Boundary |
| --- | --- |
| mobile-xs | <=430px |
| tablet | >=769px |
| desktop | >=1024px |
| wide | >=1440px |

Prefer site variants for new site layouts; preserve intentional primitive breakpoints. Do not replace tablet with 768px or invent equivalent ad hoc boundaries. CSS queries must match the chosen configured boundary.

Use [Section/SiteContainer](section-components-standard.md) for matching spacing/gutters. Keep local composition with its owner, avoid double containers, and preserve established stacking scopes and header offsets.

## Class rules

- Write complete static classes, never fragments such as `bg-${color}-500`. Use ternaries, cn, and finite class maps/CVA as appropriate; do not add CVA for a trivial branch.
- Components adding defaults merge `cn(defaultClasses, className)`. Written token order alone is not CSS conflict resolution.
- Prefer tokens/variants. Arbitrary values suit unique geometry, variable bridges, or unsupported design requirements; promote repeated values only when responsibilities match.
- Utilities come first. globals.css owns base styles, tokens, and minimal shared utilities. Scoped CSS may handle a required selector or layout that utilities express poorly; do not add a parallel styling system or conceal component ownership.
- Define reusable custom animations in `tailwind.config.ts` through `theme.extend.animation`, with their keyframes in `theme.extend.keyframes`.
- Prefer `transform` and `opacity` for animation; avoid animating layout properties such as `width`, `height`, `top`, or `left`.
- Use Tailwind transitions for hover, focus, pressed, expanded, and selected states. 
- Preserve relevant hover/focus/disabled/open/reduced-motion behavior. Replace removed outlines visibly and verify changed overlays/sticky elements together.
- Content scanning covers actual sources, not node_modules, the whole workspace, or generated CSS. Safelist must not compensate for dynamic class fragments.

Use the shared [validation matrix](validation.md); this template has no Storybook command. Do not copy a generic styling checklist into each Skill.
