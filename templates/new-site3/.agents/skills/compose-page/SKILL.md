---
name: compose-page
description: Bootstrap current.json or change Site Schema Page paths and Section composition, matching actual capabilities to content, layout, interactions, and headings.
---

# Compose a Page

Use for bootstrapping `current.json`, Page creation/path changes, and adding, reordering, repeating, or removing instances. Data edits use [edit-site-content](../edit-site-content/SKILL.md); capability gaps use [create-section](../create-section/SKILL.md).

Read [content rules](../../reference/content-contract.md), [headings](../../reference/html-heading-hierarchy-standard.md), and [validation](../../reference/validation.md). Read UI/styling references only when changing presentation.

If `current.json` is missing, intentionally being replaced, or still contains unrelated template business content, read [Bootstrap current.json](references/bootstrap-current-json.md). Its shape example explains topology only; construct the document from current contracts and sourced content. Do not bootstrap during an ordinary Page edit.

1. Resolve the target and acceptance criteria from context; clarify material ambiguity only. Record the h1 provider and Section/child outline.
2. Inspect generated capabilities.json and selected descriptors, contracts, Definitions, Views, and relevant private components. Match real content structure, media, responsive layout, actions, interactions, and headings; storing the copy is insufficient.
3. Reuse fitting capabilities, including repeated instances when appropriate. Extend compatibly if meaning is unchanged; add a capability if structure/meaning differs. Resolve authorized gaps rather than drop requirements, invent filler, or copy private Views into pages.
4. Compose in current.json, preserving identity/ownership. Recheck the whole outline and links. Content routes use the existing catch-all renderer.
5. Validate the final composition and affected routes. Report capabilities, evidence, failures, and unverified items. Valid JSON/build alone does not establish acceptance.

Keep brand consistency through shared tokens/components and interactions without forcing every Page into the same layout.
