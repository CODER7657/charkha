import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "agents/**/*.test.ts", "apps/**/*.test.{ts,tsx}"],
    environment: "node",
    passWithNoTests: true,
  },
});
