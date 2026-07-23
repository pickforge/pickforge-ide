import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["coverage/**", "dist/**", "node_modules/**", "src-tauri/gen/**"],
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
  },
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    rules: {
      complexity: ["error", 15],
      "max-lines-per-function": [
        "error",
        { max: 100, skipBlankLines: true, skipComments: true },
      ],
      "max-depth": ["error", 4],
    },
  },
  {
    files: ["tests/**/*.{ts,tsx}"],
    rules: {
      "max-lines-per-function": "off",
    },
  },
];
