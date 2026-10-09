import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

export function Eyebrow({ className, ...props }: ComponentPropsWithoutRef<"p">) {
  return <p {...props} className={cn("t-eyebrow", className)} />;
}
