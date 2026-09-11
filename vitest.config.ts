import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "agents/**/*.test.ts", "apps/**/*.test.{ts,tsx}"],
    environment: "node",
    passWithNoTests: true,
    /* The database-backed suites share one Postgres, and decision_log is a
       single global append-only chain - two files truncating and appending to
       it at once fail each other rather than the code. The whole suite runs in
       a couple of seconds, so serialising files is cheap insurance. */
    fileParallelism: false,
  },
});
