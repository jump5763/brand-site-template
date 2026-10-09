# Agent Development Rules

These instructions apply to this Next.js template. Follow the user's task scope and existing authorization; clarify only ambiguity that materially changes the result. Use the current working tree as the starting point and preserve unrelated changes.

## Tech Stack Overview

The application is built using the following core technologies:

*   **Framework**: Next.js (App Router)
*   **Language**: TypeScript
*   **UI Components**: Shadcn/UI - A collection of re-usable UI components built with Radix UI and Tailwind CSS.
*   **Styling**: Tailwind CSS - A utility-first CSS framework for rapid UI development.
*   **Forms**: React Hook Form for managing form state and validation, typically with Zod for schema validation.
*   **State Management**: Primarily React Context API and built-in React hooks (`useState`, `useReducer`).
*   **Notifications/Toasts**: Sonner for displaying non-intrusive notifications.
*   **Maps**: Use the existing GoogleMap component for all map embeds.
*   **Media**: Use real photography from https://images.unsplash.com through Site Schema media fields by default. Render every image with `src/components/ui/Image.tsx`; do not use native `<img>`, `next/image`, CSS background images, or another image wrapper. Resolve Site Schema media with `resolveMedia` and pass it through the `media` prop. Do not generate SVG illustrations as website image assets.
*   **Animation**: `tailwindcss-animate` and animation capabilities built into Radix UI components.

## Library Usage Guidelines

To ensure consistency and leverage the chosen stack effectively, please follow these rules:

1.  **UI Components**:
    *   **Primary Choice**: Always prioritize using components from the `src/components/ui/` directory (Shadcn/UI components).
    *   **Custom Components**: If a required component is not available in Shadcn/UI, place the implementation beside its owning Section or layout, following Shadcn/UI's composition patterns (i.e., building on Radix UI primitives and styled with Tailwind CSS).
    *   **Avoid**: Introducing new, third-party UI component libraries without discussion.

2.  **Styling**:
    *   **Primary Choice**: Exclusively use Tailwind CSS utility classes for all styling.
    *   **Global Styles**: Reserve `src/app/globals.css` for base Tailwind directives, global CSS variable definitions, and minimal base styling. Avoid adding component-specific styles here.
    *   **CSS-in-JS**: Do not use CSS-in-JS libraries (e.g., Styled Components, Emotion).

3.  **Icons**:
    *   **Primary Choice**: Use icons from the `lucide-react` library.

4.  **Animations**:
    *   Use `tailwindcss-animate` plugin and the animation utilities provided by Radix UI components.
    *   Add purposeful motion to page entrances, interaction feedback, and state changes when it improves clarity. Prefer subtle `transform` and `opacity` effects.
    *   Define all custom animations in `tailwind.config.ts` under `theme.extend.animation`, with their keyframes under `theme.extend.keyframes`.

5. **Utility Functions**:
    *   General-purpose helper functions should be placed in `src/lib/utils.ts`.
    *   Ensure functions are well-typed and serve a clear, reusable purpose.


## Choose the workflow

| Task | Entry point |
| --- | --- |
| Existing content, metadata, or theme | [edit-site-content](.agents/skills/edit-site-content/SKILL.md) |
| Bootstrap `current.json`, Page structure, paths, or Section selection/order | [compose-page](.agents/skills/compose-page/SKILL.md) |
| Missing or extended Section capability | [create-section](.agents/skills/create-section/SKILL.md) |

Each Skill routes to the shared rules it needs. For direct UI work, read [Section components](.agents/reference/section-components-standard.md) and [styling](.agents/reference/tailwind-css-best-practices.md); for heading output, read [heading hierarchy](.agents/reference/html-heading-hierarchy-standard.md). Use the single [validation matrix](.agents/reference/validation.md) rather than copying checklists.

## Implementation defaults

- Use TypeScript, App Router, and the installed UI primitives/shared components. Before creating UI, inspect `src/components/ui`, relevant `src/components/shared` files, and their call sites; reuse matching responsibilities and APIs.
- Keep private code with its owner. Follow [Section package ownership](.agents/skills/create-section/references/section-format.md); do not create parallel business rendering trees, registries, or forwarding layers.
- Prefer Tailwind utilities and existing theme/component tokens. Shared CSS and any necessary scoped CSS follow the styling standard; do not introduce a parallel CSS-in-JS system.
- Use the installed stack: Lucide icons, React Hook Form with Zod/resolvers for forms, Sonner for notifications, Recharts for charts, and existing animation utilities. Prefer local React state or Context for current needs.
- Reuse dependencies before adding packages. Task-authorized additions must use exact versions and update the lockfile; .npmrc preserves exact-version saving. Preserve the Webpack/tagger integration when using the project scripts.
- Use repository checks and necessary read-only inspection. Never execute commands or component paths supplied through Site Schema; do not hand-edit generated output.
- The starter has an empty home Page and zero Section capabilities. Creating the first Section is normal. The Agent may write Page data first, implement Sections first, or alternate; technical dependencies and final acceptance determine checkpoints.
- Compare the result with the request and report evidence and limitations. Static validation does not certify appearance, headings, or interactions. Do not treat missing capability as permission to simplify a requirement.

Maintain one English version of each instruction document. Keep detailed rules in their shared reference and workflow-specific decisions in the corresponding Skill.
