import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTypescript,
  { ignores: [".next/**", ".next-*/**", "dist/**", "node_modules/**", "output/**", ".playwright-cli/**", "templates/**"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    // Template Image receives alt text through its validated media prop.
    rules: { "jsx-a11y/alt-text": ["error", { img: [] }] },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/templates/*/components/ui/Image.tsx"],
    rules: {
      "no-restricted-syntax": ["error",
        { selector: "ImportDeclaration[source.value='next/image']", message: "Use the template Image component." },
        { selector: "JSXOpeningElement[name.name='img']", message: "Use the template Image component." },
      ],
    },
  },
  { files: ["**/*.cjs"], rules: { "@typescript-eslint/no-require-imports": "off" } },
];

export default config;
