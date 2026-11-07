import { describe, it, expect } from "vitest";
import { RunMatchingInput, type Match, type ResidueLot } from "@charkha/core";
import { DEFAULT_RADIUS_KM, RADIUS_OPTIONS, summarise, unplacedMessage } from "./summary.ts";

const lot = (over: Partial<ResidueLot> = {}): ResidueLot => ({
  lotId: "lot_a",
  producerId: "prod_x",
  at: { lat: 30.9, lon: 75.86 },
  district: "Ludhiana",
  feedstock: "mixed",
  tonnes: 2,
  availableFrom: "2026-09-12T08:00:00.000Z",
  sourceDetectionId: "det_a",
  status: "listed",
  ...over,
});

const match = (over: Partial<Match> = {}): Match => ({
  matchId: "match_a",
  lotId: "lot_a",
  unitId: "unit_ldh",
  distanceKm: 43.8,
  transportKgCo2e: 17.8,
  assignedTonnes: 2.9,
  decidedAt: "2026-09-12T08:00:00.000Z",
  rationale: "only accepting unit in range, 43.8 km, 28.5 t capacity free",
  ...over,
});

describe("match radius", () => {
  /* If the view's default and the contract's default drift, the screen says
     one radius and the matchmaker uses another. */
  it("defaults to the same radius the contract does", () => {
    expect(DEFAULT_RADIUS_KM).toBe(RunMatchingInput.parse({}).maxRadiusKm);
  });

  it("offers the default among its options, ascending", () => {
    expect(RADIUS_OPTIONS).toContain(DEFAULT_RADIUS_KM);
    expect([...RADIUS_OPTIONS]).toEqual([...RADIUS_OPTIONS].sort((a, b) => a - b));
  });

  it("stays inside what the contract will accept", () => {
    for (const km of RADIUS_OPTIONS) {
      expect(() => RunMatchingInput.parse({ maxRadiusKm: km })).not.toThrow();
    }
  });
});

describe("the summary strip", () => {
  /* THE BUG THIS EXISTS FOR. The strip read "43 lots / 14.1 t" on the
     deployed host because the count included matched lots and the tonnes did
     not - a third of a tonne per lot. */
  it("counts and weighs the same lots", () => {
    const lots = [
      lot({ lotId: "a", tonnes: 5, status: "listed" }),
      lot({ lotId: "b", tonnes: 7, status: "listed" }),
      lot({ lotId: "c", tonnes: 100, status: "matched" }),
      lot({ lotId: "d", tonnes: 100, status: "credited" }),
    ];
    const t = summarise(lots, []);

    expect(t.listed).toBe(2);
    expect(t.tonnes).toBe(12);
    // The map still draws everything, and the strip says so separately.
    expect(t.onMap).toBe(4);
    // The ratio a judge computes in their head has to be plausible.
    expect(t.tonnes / t.listed).toBeCloseTo(6, 5);
  });

  it("reports matched and debit from this round, not from lot history", () => {
    const lots = [lot({ status: "matched" }), lot({ lotId: "b", status: "matched" })];
    const t = summarise(lots, [match({ transportKgCo2e: 10 }), match({ matchId: "m2", transportKgCo2e: 7.5 })]);

    expect(t.matched).toBe(2);
    expect(t.debit).toBeCloseTo(17.5, 5);
    // Two matched lots on the map, but none of them listed.
    expect(t.listed).toBe(0);
    expect(t.tonnes).toBe(0);
  });

  it("handles an empty board without dividing by zero", () => {
    expect(summarise([], [])).toEqual({ listed: 0, onMap: 0, tonnes: 0, matched: 0, debit: 0 });
  });
});

describe("what the panel says when nothing placed", () => {
  /* THE FAILURE CASE: a radius that places nothing must still explain
     itself, naming the radius it actually used. */
  it("names the count and the radius that refused them", () => {
    expect(unplacedMessage(6, 60)).toBe(
      "6 lots could not be placed within 60 km of a unit with capacity.",
    );
  });

  it("quotes whichever radius the round ran at, not a constant", () => {
    // Same lots, wider radius - the sentence has to follow the request, or
    // the screen contradicts the matchmaker's own per-lot reason.
    expect(unplacedMessage(3, 75)).toContain("within 75 km");
    expect(unplacedMessage(3, 115)).toContain("within 115 km");
    expect(unplacedMessage(3, 115)).not.toContain("60");
  });

  it("reads correctly for a single lot", () => {
    expect(unplacedMessage(1, 60)).toContain("1 lot could not");
    expect(unplacedMessage(1, 60)).not.toContain("1 lots");
  });
});
