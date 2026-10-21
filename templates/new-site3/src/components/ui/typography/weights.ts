export const typographyWeightVariants = {
  regular: "font-normal",
  medium: "font-medium",
  semibold: "font-semibold",
  bold: "font-bold",
} as const;

export type TypographyWeight = keyof typeof typographyWeightVariants;
