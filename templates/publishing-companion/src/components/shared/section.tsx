import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";
import { SiteContainer } from "./site-container";

export type SectionSpacing = "standard" | "spacious" | "none";

const spacingClasses: Record<SectionSpacing, string> = {
  standard: "py-[var(--section-space-y)]",
  spacious: "py-[var(--section-space-y-spacious)]",
  none: "",
};

export type SectionProps = ComponentPropsWithoutRef<"section"> & {
  spacing?: SectionSpacing;
  container?: "site" | "none";
  containerClassName?: string;
};

export function Section({
  spacing = "standard",
  container = "site",
  containerClassName,
  className,
  children,
  ...props
}: SectionProps) {
  return (
    <section {...props} className={cn(spacingClasses[spacing], className)}>
      {container === "site" ? (
        <SiteContainer className={containerClassName}>{children}</SiteContainer>
      ) : (
        children
      )}
    </section>
  );
}
