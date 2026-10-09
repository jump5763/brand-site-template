import {createElement, type ComponentPropsWithoutRef, type ElementType} from "react";
import {cva, type VariantProps} from "class-variance-authority";

import {cn} from "@/lib/utils";
import {typographyWeightVariants, type TypographyWeight} from "./weights";

const bodyVariants = cva("font-body text-inherit", {
  variants: {
    size: {
      lg: "text-[16px] leading-[1.6] mobile-xs:text-[14px] mobile-xs:leading-[1.5] tablet:text-[18px]",
      md: "text-[14px] leading-[1.5] tablet:text-[16px] tablet:leading-[1.6]",
      sm: "text-[14px] leading-[1.5]",
      xs: "text-[12px] leading-[1.5]",
    },
    weight: typographyWeightVariants,
  },
  defaultVariants: {
    size: "md",
    weight: "regular",
  },
});

export type BodySize = NonNullable<VariantProps<typeof bodyVariants>["size"]>;
type BodyElement = "p" | "span" | "div" | "a" | "blockquote" | "label" | "li" | "h3";

type BodyStyleOptions = {
  size?: BodySize;
  weight?: TypographyWeight;
  className?: string;
};

export function getBodyClassName({size, weight, className}: BodyStyleOptions = {}) {
  return cn(bodyVariants({size, weight}), className);
}

type BodyProps<T extends BodyElement = "p"> = {
  as?: T;
  size?: BodySize;
  weight?: TypographyWeight;
  className?: string;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "size" | "className">;

export function Body<T extends BodyElement = "p">({
  as,
  size,
  weight,
  className,
  ...props
}: BodyProps<T>) {
  const Component = (as ?? "p") as ElementType;
  return createElement(Component, {...props, className: getBodyClassName({size, weight, className})});
}
