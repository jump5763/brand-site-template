# Validation and Acceptance

Apply checks to the actual change; do not repeat full builds at every intermediate step.

| Change | Checks | Browser acceptance when available |
| --- | --- | --- |
| Content, metadata, media, or theme | schema:check, validate:site | Changed output, links/media, affected headings |
| Page paths or Section composition | schema:check, validate:site, final build | Affected routes, headings, layout, navigation |
| View, styling, shared component, renderer | typecheck, lint, final build; data checks if also changed | Affected consumers and relevant viewports/interactions |
| New Section, descriptor, contract, Definition | schema:generate, schema:check, validate:site, typecheck, lint, final build | An actual changed-capability instance and affected existing instances |
| Documentation or Skill only | Source accuracy, links, Skill metadata, examples | Runtime only when needed to establish a disputed fact |

Use package scripts: `pnpm schema:generate`, `pnpm schema:check`, `pnpm validate:site src/site-schema/current.json`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`.

- Generate after capability/contract inputs change, before using new types. Text/CSS edits do not require regeneration.
- Compose an intended instance before final integration acceptance. Compiling an unused capability does not exercise rendering. Extra builds need a concrete reason.
- Run typecheck and build serially because build rewrites `.next/types`. Use `pnpm exec next typegen` for missing Next-generated types; do not patch them.
- Preserve Webpack and the development source tagger unless explicitly migrating them. Next.js build does not run lint. Reproducible installs use exact dependencies and frozen lockfiles.

schema:check proves generated consistency; validate:site proves current data/identity/link/media policy; typecheck/lint prove configured static rules; build proves production compilation/current-route rendering. None alone proves final appearance, accessibility, interactions, remote media availability, or unused capability behavior.

Compare output with the request at relevant breakpoints/states. Apply [heading rules](html-heading-hierarchy-standard.md), verify IDs/source markers when Section boundaries change, and report paths/instances, outcomes, states, and limitations. Fix task-scope failures; unavailable runtime checks remain unverified.
