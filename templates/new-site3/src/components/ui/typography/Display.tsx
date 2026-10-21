import type {ComponentPropsWithoutRef} from "react";
import {cva} from "class-variance-authority";

import {cn} from "@/lib/utils";
import {typographyWeightVariants, type TypographyWeight} from "./weights";

const displayVariants = cva(
  "font-heading text-inherit text-[64px] leading-[1.2] tablet:text-[110px] tablet:leading-none",
  {
    variants: {weight: typographyWeightVariants},
    defaultVariants: {weight: "medium"},
  },
);

type DisplayProps = ComponentPropsWithoutRef<"h1"> & {
  weight?: TypographyWeight;
};

export function Display({weight, className, ...props}: DisplayProps) {
  return <h1 {...props} className={cn(displayVariants({weight}), className)} />;
}
