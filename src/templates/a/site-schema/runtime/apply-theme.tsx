import type { CSSProperties } from "react";
import type { FontName, Theme } from "../generated/types";

// Declare site-specific next/font/google fonts here and map their style.fontFamily.
const fonts = {
  "System Sans": "ui-sans-serif, system-ui, sans-serif",
  "System Serif": "ui-serif, Georgia, serif",
} as const satisfies Record<FontName, string>;

const colorTokens = {
  background: "background",
  foreground: "foreground",
  card: "card",
  cardForeground: "card-foreground",
  popover: "popover",
  popoverForeground: "popover-foreground",
  primary: "primary",
  primaryForeground: "primary-foreground",
  secondary: "secondary",
  secondaryForeground: "secondary-foreground",
  muted: "muted",
  mutedForeground: "muted-foreground",
  accent: "accent",
  accentForeground: "accent-foreground",
  destructive: "destructive",
  destructiveForeground: "destructive-foreground",
  border: "border",
  input: "input",
  ring: "ring",
} as const;

export function themeToCssVariables(theme: Theme): CSSProperties {
  const variables: Record<string, string> = {
    "--font-heading": fonts[theme.fonts.heading],
    "--font-typography": fonts[theme.fonts.typography],
  };
  for (const [key, token] of Object.entries(colorTokens)) {
    variables[`--${token}`] = theme.colors[key as keyof Theme["colors"]];
  }
  return variables;
}
