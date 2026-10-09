import type { ExampleDefaultSection } from "@/site-schema/generated/types";
import ExampleView, { type ExampleProps } from "./view";

export const toProps = (section: ExampleDefaultSection): ExampleProps => ({
  id: section.id,
  content: section.content,
});
export default {
  id: "example.default",
  type: "example",
  variant: "default",
  toProps,
  render: (section: ExampleDefaultSection) => (
    <ExampleView {...toProps(section)} />
  ),
} as const;
