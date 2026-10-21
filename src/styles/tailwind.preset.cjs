const defaultTheme = require("tailwindcss/defaultTheme");

// Keep hex tokens intact while supporting Tailwind opacity modifiers.
const color = (token) =>
  `color-mix(in srgb, var(--${token}) calc(<alpha-value> * 100%), transparent)`;

const bodyFontFamily = [
  "var(--font-typography)",
  "ui-sans-serif",
  "system-ui",
  "sans-serif",
];

module.exports = {
  darkMode: ["class"],
  theme: {
    screens: {
      ...defaultTheme.screens,
      "mobile-xs": { max: "430px" },
      tablet: "769px",
      desktop: "1024px",
      wide: "1440px",
    },
    extend: {
      fontFamily: {
        sans: bodyFontFamily,
        body: bodyFontFamily,
        heading: ["var(--font-heading)", "ui-serif", "Georgia", "serif"],
      },
      colors: {
        background: color("background"),
        foreground: color("foreground"),
        card: { DEFAULT: color("card"), foreground: color("card-foreground") },
        popover: { DEFAULT: color("popover"), foreground: color("popover-foreground") },
        primary: { DEFAULT: color("primary"), foreground: color("primary-foreground") },
        secondary: { DEFAULT: color("secondary"), foreground: color("secondary-foreground") },
        muted: { DEFAULT: color("muted"), foreground: color("muted-foreground") },
        accent: { DEFAULT: color("accent"), foreground: color("accent-foreground") },
        destructive: { DEFAULT: color("destructive"), foreground: color("destructive-foreground") },
        border: color("border"),
        input: color("input"),
        ring: color("ring"),
        chart: {
          "1": color("chart-1"),
          "2": color("chart-2"),
          "3": color("chart-3"),
          "4": color("chart-4"),
          "5": color("chart-5"),
        },
        sidebar: {
          DEFAULT: color("sidebar-background"),
          foreground: color("sidebar-foreground"),
          primary: color("sidebar-primary"),
          "primary-foreground": color("sidebar-primary-foreground"),
          accent: color("sidebar-accent"),
          "accent-foreground": color("sidebar-accent-foreground"),
          border: color("sidebar-border"),
          ring: color("sidebar-ring"),
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        marquee: {
          "0%": {
            transform: "translateX(0)",
          },
          "100%": {
            transform: "translateX(-50%)",
          },
        },
        "fade-up": {
          "0%": {
            opacity: "0",
            transform: "translateY(16px)",
          },
          "100%": {
            opacity: "1",
            transform: "translateY(0)",
          },
        }
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        marquee: "marquee 32s linear infinite",
        "fade-up": "fade-up 0.6s cubic-bezier(0.22, 1, 0.36, 1) both"
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
