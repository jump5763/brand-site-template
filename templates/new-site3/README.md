# Next.js Site Schema Template

The starter renders an empty home Page from `src/site-schema/current.json` through `src/app/[[...slug]]/page.tsx`. It begins with zero Section capabilities and displays `Blank page` until the Agent implements and composes content.

## Getting started

Use Node.js 20.9 or newer and the exact dependency versions in [package.json](package.json).

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open the URL printed by the development server. VS Code should use the workspace TypeScript version; restart its TypeScript server after dependency changes if stale diagnostics remain.

Both dev and build explicitly use Webpack. The development component tagger supplies CodeForma's source-location attributes; migrating the bundler requires verifying that integration. Production builds omit the attributes. Next.js 16 build does not run lint.

`.npmrc` keeps new dependencies exact, while `pnpm-lock.yaml` locks transitive resolution. Commit manifest and lockfile changes together.

## Authoring and implementation

Start with [AI_RULES.md](AI_RULES.md) and choose the content-editing, Page-composition, or Section-development Skill. The template's maintained references are:

- [Content contract](.agents/reference/content-contract.md): ownership, identities, links, media, and generation.
- [Shared Section components](.agents/reference/section-components-standard.md): Section, SiteContainer, SectionHeader, Eyebrow, and Body.
- [Heading hierarchy](.agents/reference/html-heading-hierarchy-standard.md): Page and nested semantics, IDs, accessible states, and acceptance.
- [Styling rules](.agents/reference/tailwind-css-best-practices.md): project tokens, breakpoints, and CSS boundaries.
- [Validation matrix](.agents/reference/validation.md): checks by change type and their practical limits.

For a new site without a suitable `current.json`, follow [Bootstrap current.json](.agents/skills/compose-page/references/bootstrap-current-json.md). Its example shows document topology only; build the actual draft from current contracts and sourced site content.

Use the Schema as the Page/content source. Keep real Views and private logic beside their Section. Design Header/Footer only when requested and give shared shell content an explicit owner; the starter has no `layout` Schema field. Full ownership and scaffolding rules are in [Section package format](.agents/skills/create-section/references/section-format.md).

The agreed runtime model, Agent flow, acceptance levels, and implementation notes are recorded in [Blank Template and Agent Implementation Flow](docs/blank-template-and-agent-flow.md).

For framework and hosting details, consult the [Next.js documentation](https://nextjs.org/docs).
