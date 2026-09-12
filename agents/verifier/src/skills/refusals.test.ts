import { describe, it, expect } from "vitest";
import { isCallerError } from "@charkha/a2a";
import { MalformedEvidenceError } from "./verifyEvidence.ts";

/* ------------------------------------------------------------------ *
 * The verifier's refusals, held to the same rule as the registry's.
 *
 * `agents/registry/src/skills/refusals.test.ts` pins every registry refusal to
 * the 400 classifier. It did not cover this agent, and the gap was real: an
 * end-to-end run against the deployed host posted a malformed evidence body
 * and got
 *
 *     HTTP 500  {"error":"internal", ...}
 *
 * for a payload problem that is entirely the caller's. A working guard,
 * reported as an outage — which is precisely the failure the registry file
 * was written to prevent, in the one agent it did not reach.
 *
 * Same discipline: no wording is asserted. Reword any refusal you like; this
 * only goes red if one stops being recognised as a caller error.
 * ------------------------------------------------------------------ */

describe("every verifier refusal classifies as a caller error", () => {
  it("malformed evidence, refused before inference", () => {
    const err = new MalformedEvidenceError([
      "clientScores is missing: canary:good_char, canary:poor_char, canary:not_char",
    ]);
    expect(isCallerError(err.message)).toBe(true);
  });

  it("malformed evidence with several problems at once", () => {
    const err = new MalformedEvidenceError([
      "imageHash must be 64 hex characters",
      "pyrolysisPeakTempC out of range",
    ]);
    expect(isCallerError(err.message)).toBe(true);
  });

  /* Re-submitting the same evidenceId with different content is the caller
     contradicting themselves, not a fault on our side. */
  it("same evidenceId submitted with different content", () => {
    expect(
      isCallerError("evidenceId evi_1 was already submitted with different content - refused"),
    ).toBe(true);
  });

  it("evidence already being verified by another process", () => {
    expect(
      isCallerError("evidenceId evi_1 is being verified by another verifier process - retry shortly"),
    ).toBe(true);
  });

  it("schema rejection from the A2A wrapper", () => {
    expect(isCallerError('invalid input for "verifyEvidence": evidenceId is required')).toBe(true);
  });
});

describe("genuine faults stay 500", () => {
  /* The classifier must not swallow our own breakage. A model that will not
     load is our problem, and it should page us rather than telling the caller
     they sent something wrong. */
  for (const fault of [
    "no model loaded",
    "ml/models/char-quality.onnx: model has no input or output",
    'model produced no "probs" output',
    "ECONNREFUSED 127.0.0.1:5432",
    "connect ETIMEDOUT",
  ]) {
    it(`"${fault.slice(0, 40)}" is not a caller error`, () => {
      expect(isCallerError(fault)).toBe(false);
    });
  }
});
