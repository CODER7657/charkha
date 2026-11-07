import { describe, expect, it } from "vitest";
import { refusalFrom } from "./api.ts";

/* ------------------------------------------------------------------ *
 * The reason an agent gave, shown to the person who caused it.
 *
 * Reported from the deployed host: submitting field evidence rendered
 *
 *   /evidence -> HTTP 400
 *
 * and nothing else. The server had in fact said exactly what was wrong -
 * "hcOrgRatio 89 is out of bounds" - and the client discarded the body and
 * printed the status code. A field worker was told a number was wrong on a
 * screen with seven of them, without being told which.
 * ------------------------------------------------------------------ */

describe("refusalFrom", () => {
  /* The exact body the deployed verifier returned for the reported case. */
  it("pulls the reason out of a real agent refusal", () => {
    const body = JSON.stringify({
      error: "refused",
      agent: "verifier",
      skill: "verifyEvidence",
      message: "verifier.verifyEvidence: malformed evidence, refused before inference: hcOrgRatio 89 is out of bounds",
    });
    expect(refusalFrom(body)).toBe("malformed evidence, refused before inference: hcOrgRatio 89 is out of bounds");
  });

  /* The reader is a farmer, not an operator: "verifier.verifyEvidence:" is
     noise in front of the sentence that helps. */
  it.each([
    ["registry.issueCredit: evidence has already been credited", "evidence has already been credited"],
    ["producer.declareWaste: tonnes must be positive", "tonnes must be positive"],
  ])("strips the agent.skill prefix from %s", (raw, want) => {
    expect(refusalFrom(JSON.stringify({ message: raw }))).toBe(want);
  });

  it("keeps a message that has no prefix", () => {
    expect(refusalFrom(JSON.stringify({ message: "rate limited" }))).toBe("rate limited");
  });

  it("falls back to the error field when there is no message", () => {
    expect(refusalFrom(JSON.stringify({ error: "no such task id" }))).toBe("no such task id");
  });

  /* A proxy error page, a gateway timeout, an empty body. The caller must be
     able to tell "no reason given" from "here is the reason", so that it can
     fall back to the status line rather than printing "null". */
  it.each(["", "<html>502 Bad Gateway</html>", "not json at all", "{}", '{"message":"   "}'])(
    "returns null when there is no usable reason: %o",
    (body) => {
      expect(refusalFrom(body)).toBeNull();
    },
  );

  it("ignores a non-string message rather than rendering an object", () => {
    expect(refusalFrom(JSON.stringify({ message: { nested: true } }))).toBeNull();
  });
});
