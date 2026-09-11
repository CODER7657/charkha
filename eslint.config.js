import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Deliberately light. Lint is here to catch real mistakes before review, not
 * to start style arguments at 2am. Formatting is Prettier's job.
 */
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "ml/**",
      "**/*.config.js",
      "**/*.config.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Prefix with _ when a parameter genuinely has to exist but is unused.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      // `any` is a smell, but a stub that has not been written yet is not a bug.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-empty-object-type": "off",
      // The A2A SDK's protobuf types need a few casts at the boundary.
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "no-console": "off",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-implicit-coercion": "error",
    },
  },
  {
    // Plain .mjs/.js get js.configs.recommended, where no-undef is active -
    // typescript-eslint turns it off for .ts because the compiler already
    // does that job. Declare the Node/web globals these scripts use rather
    // than pulling in another dependency for it.
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
        fetch: "readonly",
        AbortSignal: "readonly",
        URL: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
  },
  {
    // Tests may be loose about types.
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
);
