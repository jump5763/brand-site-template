module.exports = {
  presets: [require("../../styles/tailwind.preset.cjs")],
  content: { relative: true, files: ["./**/*.{js,ts,jsx,tsx}", "../../shared/**/*.{ts,tsx}", "../../app/sites/a/**/*.{ts,tsx}"] },
};
