import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "agents/**/*.test.ts", "apps/**/*.test.{ts,tsx}"],
    environment: "node",
    /* Loads the repo-root .env. Without it DATABASE_URL was absent unless a
       developer exported it by hand, and every database-backed suite skipped
       silently - 32 tests, including the only proof that the one-photograph
       guarantee actually holds under concurrency. */
    setupFiles: ["./vitest.setup.ts"],
    passWithNoTests: true,
    /* The database-backed suites share one Postgres, and decision_log is a
       single global append-only chain - two files truncating and appending to
       it at once fail each other rather than the code. The whole suite runs in
       a couple of seconds, so serialising files is cheap insurance. */
    fileParallelism: false,
  },
});
