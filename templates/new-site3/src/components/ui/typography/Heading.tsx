import type {ComponentPropsWithoutRef} from "react";
import {cva} from "class-variance-authority";

import {cn} from "@/lib/utils";
import {typographyWeightVariants, type TypographyWeight} from "./weights";

const headingVariants = cva("font-heading text-inherit", {
  variants: {
    variant: {
      "display-lg": "text-[96px] leading-[1.1] mobile-xs:text-[48px] mobile-xs:leading-[1.2]",
      "display-md": "text-[64px] leading-[1.2] mobile-xs:text-[32px] mobile-xs:leading-[1.3]",
      "title-xl": "text-[48px] leading-[1.2]",
      "title-lg": "text-[32px] leading-[1.3]",
      "title-md": "text-[24px] leading-[1.3]",
      "title-sm": "text-[20px] leading-[1.4]",
    },
    weight: typographyWeightVariants,
  },
  defaultVariants: {weight: "medium"},
});

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type HeadingVariant = "display-lg" | "display-md" | "title-xl" | "title-lg" | "title-md" | "title-sm";

type HeadingProps = ComponentPropsWithoutRef<"h1"> & {
  level: HeadingLevel;
  variant: HeadingVariant;
  weight?: TypographyWeight;
};

export function Heading({level, variant, weight, className, ...props}: HeadingProps) {
  const classNames = cn(headingVariants({variant, weight}), className);

  switch (level) {
    case 1:
      return <h1 {...props} className={classNames} />;
    case 2:
      return <h2 {...props} className={classNames} />;
    case 3:
      return <h3 {...props} className={classNames} />;
    case 4:
      return <h4 {...props} className={classNames} />;
    case 5:
      return <h5 {...props} className={classNames} />;
    case 6:
      return <h6 {...props} className={classNames} />;
  }
}
