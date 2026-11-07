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
const url = process.env["DATABASE_URL"];

if (!url) {
  console.warn(
    "\n  DATABASE_URL is not set - every database-backed suite will SKIP.\n" +
      "  Those cover the ledger chain, status-list indices, and the one-photograph\n" +
      "  guarantee, all of which are enforced by Postgres and by nothing else.\n" +
      "  To run them:  docker compose up -d db && pnpm db:push\n",
  );
} else {
  /* Set but unreachable is the third state, and the one that looks like a repo
     bug. Those suites gate on the variable being present, not on the database
     answering - so they run and fail with six ECONNREFUSED stacks that name
     neither the cause nor the machine it is on.

     Harsh hit exactly this and nearly filed it as a regression in #54: his .env
     carried DATABASE_URL=...localhost:5432 from copying .env.example for the
     FIRMS key, with no Postgres running. Running clean main and getting the
     identical six failures is what told him it was his environment.

     Failing is correct - setting the variable asserts a database exists - so
     this does not skip or swallow anything. It just says which of the three
     states you are in, before the stacks scroll past. */
  const { createConnection } = await import("node:net");
  const target = (() => {
    try {
      const u = new URL(url);
      return { host: u.hostname, port: Number(u.port || 5432) };
    } catch {
      return null;
    }
  })();

  const reachable = target
    ? await new Promise<boolean>((resolve) => {
        const socket = createConnection({ host: target.host, port: target.port });
        const done = (ok: boolean) => {
          socket.destroy();
          resolve(ok);
        };
        socket.setTimeout(400);
        socket.once("connect", () => done(true));
        socket.once("timeout", () => done(false));
        socket.once("error", () => done(false));
      })
    : false;

  if (!reachable) {
    console.warn(
      `\n  DATABASE_URL is set but nothing is listening on ${target ? `${target.host}:${target.port}` : url}.\n` +
        "  The database-backed suites will RUN and FAIL - they gate on the variable\n" +
        "  being present, not on the database answering. This is your environment,\n" +
        "  not a broken repo: clean main fails the same way.\n" +
        "  Either start it:  docker compose up -d db && pnpm db:push\n" +
        "  or unset DATABASE_URL to skip those suites instead.\n",
    );
  }
}
