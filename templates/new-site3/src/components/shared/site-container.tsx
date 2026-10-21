import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

export function SiteContainer({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div {...props} className={cn("container-site", className)} />;
}
