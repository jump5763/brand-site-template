---
name: create-section
description: Create or compatibly extend registered Section packages when existing content structure, layout, interactions, or heading capabilities do not fit.
---

# Create or Extend a Section

For concrete capability gaps. Data edits use [edit-site-content](../edit-site-content/SKILL.md); composition uses [compose-page](../compose-page/SKILL.md).

Creating the first Section is the normal path in a blank starter. On later work, inspect existing capabilities before adding another.

Read [package format](references/section-format.md), [content rules](../../reference/content-contract.md), and [validation](../../reference/validation.md). Presentation work requires [Section components](../../reference/section-components-standard.md), [headings](../../reference/html-heading-hierarchy-standard.md), and [styling](../../reference/tailwind-css-best-practices.md).

1. Identify the gap and acceptance criteria; inspect related capabilities and shared UI. Extend compatible meaning; introduce a variant/type only for distinct structure or meaning.
2. Choose capability ID = type.variant = directory name, separate from Page instance IDs. Declare actual server/client-island behavior and root/child heading support.
3. Adapt all four [template files](assets/section-template/section.json), replacing placeholders. Keep rendering in View and data adaptation in Definition; update contract/descriptor where required.
4. Generate before using new generated types. After structural/code checks, compose an instance and build the final result once; compiling an unused capability is not runtime evidence.
5. Validate the instance and affected existing consumers; fix task-scope failures and report remaining gaps.

No second Registry or manual generated-file edits. Shared extensions must remain compatible and serve matching responsibilities. Authorized dependency changes use exact versions and update the lockfile.
