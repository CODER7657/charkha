import { describe, it, expect } from "vitest";
import { isCallerError } from "@charkha/a2a";
import { DeclareWasteInput, IngestBurnsInput } from "@charkha/core";

/* ------------------------------------------------------------------ *
 * EVERY REFUSAL IS THE CALLER'S FAULT, AND MUST BE REPORTED AS ONE.
 *
 * The gateway answers 400 for a refusal and 500 for a fault, and it decides
 * which by matching the message TEXT (`isCallerError` in packages/a2a). So
 * the status code depends on our prose: a refusal whose wording drifts out of
 * that pattern silently becomes a 500 - a working guard that looks like an
 * outage, in front of a judge, with nothing failing in CI. The registry and
 * the verifier each keep a file like this; the producer had none.
 *
 * NOTE ON WHAT IS BEING TESTED HERE.
 *
 * Every declaration refusal is a SCHEMA refusal, enforced at the A2A boundary
 * before the skill runs - `declareWaste` deliberately re-checks nothing. The
 * boundary builds `invalid input for "<skill>": ...` and throws, so these
 * tests reproduce that one line (packages/a2a/src/server.ts, SkillExecutor)
 * rather than booting a server for four assertions. That duplication is the
 * cost of not owning that file, and it is why the sentence is built in ONE
 * place below: if the boundary's wording changes, this file is the thing to
 * change with it.
 * ------------------------------------------------------------------ */

/** What the A2A boundary throws when a payload fails the skill's schema. */
const boundaryRefusal = (skill: string, schema: { safeParse: (v: unknown) => { success: boolean; error?: { message: string } } }, payload: unknown): string => {
  const parsed = schema.safeParse(payload);
  if (parsed.success) throw new Error(`expected "${skill}" to refuse this payload, but it was accepted`);
  return `invalid input for "${skill}": ${parsed.error!.message}`;
};

const declaration = {
  declaredBy: "Ward 7, Ludhiana Municipal Corporation",
  feedstock: "mixed",
  tonnes: 4.5,
  at: { lat: 30.9, lon: 75.86 },
  district: "Ludhiana",
};

describe("declareWaste refuses, and reports it as the caller's problem", () => {
  /* A claim nobody is accountable for is worth less than no claim - the whole
     weight of a declaration is that somebody put their name to it. */
  it("an anonymous declaration", () => {
    const msg = boundaryRefusal("declareWaste", DeclareWasteInput, { ...declaration, declaredBy: "" });
    expect(isCallerError(msg), msg).toBe(true);
  });

  it("a declaration with no declarer at all", () => {
    const { declaredBy: _omitted, ...anonymous } = declaration;
    const msg = boundaryRefusal("declareWaste", DeclareWasteInput, anonymous);
    expect(isCallerError(msg), msg).toBe(true);
  });

  it("an impossible tonnage", () => {
    for (const tonnes of [0, -1, 10_001, Number.NaN, Number.POSITIVE_INFINITY]) {
      const msg = boundaryRefusal("declareWaste", DeclareWasteInput, { ...declaration, tonnes });
      expect(isCallerError(msg), `${tonnes}: ${msg}`).toBe(true);
    }
  });

  /* An open feedstock set is an open door: anything the matchmaker cannot
     place and the carbon maths has no factor for still becomes a lot. */
  it("a feedstock outside the closed set", () => {
    for (const feedstock of ["plastic", "PADDY_STRAW", "", null]) {
      const msg = boundaryRefusal("declareWaste", DeclareWasteInput, { ...declaration, feedstock });
      expect(isCallerError(msg), `${String(feedstock)}: ${msg}`).toBe(true);
    }
  });

  it("a point that is not on the planet", () => {
    for (const at of [{ lat: 91, lon: 75.86 }, { lat: 30.9, lon: 181 }, {}]) {
      const msg = boundaryRefusal("declareWaste", DeclareWasteInput, { ...declaration, at });
      expect(isCallerError(msg), msg).toBe(true);
    }
  });

  it("a note longer than the column it is kept in", () => {
    const msg = boundaryRefusal("declareWaste", DeclareWasteInput, { ...declaration, note: "x".repeat(281) });
    expect(isCallerError(msg), msg).toBe(true);
  });

  it("an availableFrom that is not a moment", () => {
    const msg = boundaryRefusal("declareWaste", DeclareWasteInput, { ...declaration, availableFrom: "next tuesday" });
    expect(isCallerError(msg), msg).toBe(true);
  });
});

describe("ingestBurns refuses, and reports it as the caller's problem", () => {
  /* FIRMS caps the area API at 5 days. A 7 used to pass our validation and be
     refused upstream, which turns "invalid input" into a confusing feed
     error - #48. The bound is ours to enforce, so the refusal is ours to
     report correctly. */
  it("a day range FIRMS will not serve", () => {
    for (const dayRange of [0, 6, 10, 2.5]) {
      const msg = boundaryRefusal("ingestBurns", IngestBurnsInput, { dayRange });
      expect(isCallerError(msg), `${dayRange}: ${msg}`).toBe(true);
    }
  });
});

/* The producer's own guard against the classifier being grown only against
   other agents' wording: prove the shared prefix is what carries these. */
describe("the classifier still recognises the boundary's own wording", () => {
  it("treats a schema refusal as a caller error", () => {
    expect(isCallerError('invalid input for "declareWaste": whatever follows')).toBe(true);
  });

  it("does not treat an outage as one", () => {
    expect(isCallerError("connect ECONNREFUSED 127.0.0.1:5432")).toBe(false);
  });
});
