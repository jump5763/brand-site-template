---
name: edit-site-content
description: Edit supported Site Schema content, Page metadata, or theme values while preserving identities and ownership.
---

# Edit Site Content

For existing copy, media, links, Section data, metadata, or theme data. Structure/path changes use [compose-page](../compose-page/SKILL.md); missing capabilities use [create-section](../create-section/SKILL.md).

Read [content rules](../../reference/content-contract.md) and [validation](../../reference/validation.md). Read [headings](../../reference/html-heading-hierarchy-standard.md) for displayed titles or conditional heading output. Presentation tasks use their UI/styling references; do not broaden a content-only edit.

1. Locate the owner in current.json and its core/local contract. Infer clear targets from context; clarify material ambiguity only.
2. Edit the correct declared fields: metadata, Section content, or theme. Preserve identity unless the requested task changes it. Check dependent links and repeated domain entities defined by a Section contract.
3. Inspect Definition/View code only as needed. Do not add routes, duplicate defaults, restructure components, or serialize undeclared presentation props for a data edit.
4. Apply relevant validation, including media/links/headings/conditional states. Report changed owners/paths and passed, failed, or unavailable checks.

Runtime filters and shopping-bag quantities do not belong in Schema. Start from existing content; do not invent business facts or fill gaps from unrelated examples.
