import type { CSSProperties } from "react";
import type { Theme } from "../generated/types";

const fonts = {
  "System Sans": "ui-sans-serif, system-ui, sans-serif",
  "System Serif": "ui-serif, Georgia, serif",
} as const;

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

function hsl(value: string): string {
  if (value.startsWith("hsl(")) return value.slice(4, -1);
  const [r, g, b] = [1, 3, 5].map(
    (index) => Number.parseInt(value.slice(index, index + 2), 16) / 255,
  );
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const light = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * light - 1));
  const hue =
    delta === 0
      ? 0
      : 60 *
        (max === r
          ? ((g - b) / delta + 6) % 6
          : max === g
            ? (b - r) / delta + 2
            : (r - g) / delta + 4);
  return `${hue} ${saturation * 100}% ${light * 100}%`;
}

export function themeToCssVariables(theme: Theme): CSSProperties {
  const variables: Record<string, string> = {
    "--font-heading": fonts[theme.fonts.heading],
    "--font-typography": fonts[theme.fonts.typography],
  };
  for (const [key, token] of Object.entries(colorTokens)) {
    variables[`--${token}`] = hsl(theme.colors[key as keyof Theme["colors"]]);
  }
  return variables;
}
