import { loadEnv } from "./packages/a2a/src/env.ts";

/* ------------------------------------------------------------------ *
 * Load the repo-root .env before any test reads process.env.
 *
 * The database-backed suites gate on DATABASE_URL and skip when it is
 * absent, so that a laptop without Postgres stays green. Nothing loaded
 * .env for vitest, so DATABASE_URL was absent on any machine that had not
 * exported it by hand - and the suites skipped there permanently, in
 * silence.
 *
 * That is worse than it sounds. Six files and 32 tests were not running on
 * Hem's machine, including the only proof of #46's core property: that five
 * concurrent claims on one photograph leave exactly one row. The guarantee
 * lives in a Postgres unique index, so a test that never reaches Postgres
 * proves nothing at all - and it reported itself as a pass.
 *
 * dotenv never overwrites a variable that is already set, so CI and Docker
 * keep theirs.
 * ------------------------------------------------------------------ */
loadEnv();

/* If it is still missing, say so once, loudly. A skipped database suite is a
   legitimate state on a laptop with no Postgres; it is not a legitimate thing
   to discover silently, weeks later, about a test you were relying on. */
if (!process.env["DATABASE_URL"]) {
  console.warn(
    "\n  DATABASE_URL is not set - every database-backed suite will SKIP.\n" +
      "  Those cover the ledger chain, status-list indices, and the one-photograph\n" +
      "  guarantee, all of which are enforced by Postgres and by nothing else.\n" +
      "  To run them:  docker compose up -d db && pnpm db:push\n",
  );
}
