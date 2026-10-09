import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTypescript,
  {
    ignores: [".next/**", "node_modules/**"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/ui/Image.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportDeclaration[source.value='next/image']",
          message: "Use @/components/ui/Image for all images.",
        },
        {
          selector: "JSXOpeningElement[name.name='img']",
          message: "Use @/components/ui/Image instead of a native img element.",
        },
      ],
    },
  },
  {
    files: [
      "src/components/ui/**/*.{ts,tsx}",
      "src/components/shared/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/sections/**",
                "@/app/**",
                "@/site-schema/runtime/**",
                "@/site-schema/generated",
                "@/site-schema/generated/index*",
                "**/site-schema/generated/index*",
                "**/sections/**",
                "**/app/**",
                "**/site-schema/runtime/**",
              ],
              message:
                "Shared UI must not depend on Section, route, or runtime orchestration implementations. Pass data through props.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["next-env.d.ts"],
    rules: {
      "@typescript-eslint/triple-slash-reference": "off",
    },
  },
  {
    files: ["tailwind.config.ts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];

export default eslintConfig;
