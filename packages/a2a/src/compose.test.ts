import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/* ------------------------------------------------------------------ *
 * A2A_ALLOW_ANONYMOUS turns the /a2a guard off entirely. The comment in
 * server.ts says "Never set in compose" - which is a rule a file read can
 * enforce, and a comment cannot.
 *
 * Raised alongside #92: the ordering test proves the guard stands where it
 * should, and this proves nothing on the deployed host walks around it.
 * ------------------------------------------------------------------ */

const root = join(import.meta.dirname, "..", "..", "..");

describe("nothing deployed opts out of agent authentication", () => {
  it.each(["docker-compose.yml", ".env.example"])("%s does not enable A2A_ALLOW_ANONYMOUS", (file) => {
    const text = readFileSync(join(root, file), "utf8");
    /* Any assignment at all, not just "=1". A line that sets it to something
       falsy today is one edit away from being the hole. */
    expect(text).not.toMatch(/^\s*-?\s*A2A_ALLOW_ANONYMOUS\s*[:=]/m);
  });
});
