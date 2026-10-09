# Section Package Format

Discovery scans `src/sections/<type>.<variant>/`. Adapt the [descriptor](../assets/section-template/section.json), [contract](../assets/section-template/contract.schema.json), [Definition](../assets/section-template/definition.tsx), and [View](../assets/section-template/view.tsx) together.

## Contract and identity

- Directory, descriptor ID, and Registry key equal the **capability ID**, type.variant. A Page's **instance ID** is separate and Page-unique.
- Descriptor contract/definition paths are local relative files. Keep description, useWhen/avoidWhen, rendering mode, and heading support truthful; the generator derives field summaries.
- Contract may describe a complete Section wrapper or just content. Its `$id` ends in `/<type>.<variant>` or `/<type>.<variant>.schema.json`; content-only contracts are wrapped by generation.
- `$ref` uses local JSON Pointers or `https://codeforma.local/site-schema/core#/$defs/...`, not arbitrary remote references.
- Generation covers all local capabilities. New types exist only after generation; follow the shared [validation sequence](../../../reference/validation.md).

## Implementation ownership

- Definition's render(section, site) invokes the real View through typed toProps. Ignore site when unnecessary; resolve actions with the runtime resolveAction adapter before passing props.
- Types come from generated/types.ts. View props are explicit and minimal across client boundaries. Views do not load current.json, scan files, or execute paths from data.
- Keep layout/private helpers in the owning Section. A client View can declare use client directly; avoid forwarding files that conceal ownership.
- A requested shared shell belongs in an appropriate layout/shared owner; primitives belong in components/ui, cross-owner UI patterns in components/shared, pure utilities in lib, and data orchestration in site-schema/runtime. All are under src.
- Inspect shared exports, props, behavior, and consumers before adding UI. Share only matching responsibilities/interfaces/evolution without consumer-private dependencies. Repeated Page instances do not create independent implementation owners.
- Use direct imports and descriptive files; no sibling Section-private imports, shared barrels/registries, or page-wide business view-models.

Apply [Section APIs](../../../reference/section-components-standard.md) and [heading semantics](../../../reference/html-heading-hierarchy-standard.md). The template is an h2 section below a Page h1; adapt root and children for other contexts. Component props do not automatically become contract fields.
