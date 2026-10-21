# Bootstrap current.json

Use for the first Site Schema or an intentional full replacement. The shape below shows topology only; do not copy it as valid JSON.

```jsonc
{
  "siteId": "<site-id>",
  "siteUrl": "<absolute-url>",
  "theme": {
    "fonts": { "...": "..." },
    "colors": { "...": "..." }
  },
  "pages": [{
    "id": "home",
    "path": "/",
    "metadata": { "...": "..." },
    "sections": []
  }]
}
```

Resolve site identity, Page purposes and paths, Page metadata, requested content, and supported theme values from the user and supplied sources. The checked-in starter uses `home` at `/`, but RootLayout does not depend on that ID. Header/Footer are absent until requirements justify their implementation and content ownership.

1. Inspect the core contract, generated capabilities, and relevant UI. On the blank starter, creating the first Section is normal work; later, reuse fitting capabilities before adding another.
2. Edit `current.json` directly or use a temporary draft when useful. The Agent may write Page data first, implement Sections first, or alternate, while respecting technical dependencies.
3. An empty Page gets its h1 from metadata.title. A populated Page must receive exactly one h1 from its Section composition.
4. Add cross-Page and Section actions only after their target identities exist. Design Header/Footer only when requested, with a clear code/data owner and no undeclared top-level Schema fields.
5. Validate the chosen file, regenerate after capability changes, then apply the shared Page-composition checks and inspect every generated route.

Never invent content to make validation pass or copy business content from another site. Schema validity alone does not prove media, headings, navigation, layout, or interactions are correct.
