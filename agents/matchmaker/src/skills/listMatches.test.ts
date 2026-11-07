import { describe, expect, it } from "vitest";
import { ListMatchesInput, ListMatchesOutput, MatchSummary } from "@charkha/core";

/* ------------------------------------------------------------------ *
 * The contract behind Field capture's match picker.
 *
 * Reported from the deployed host: a farmer cannot obtain a matchId. The form
 * demanded one and the only place a real id ever appeared was the Operator
 * result panel - which is empty once a round has spent the day's capacity. So
 * on any day but the first there was no route from "I have a char pile" to the
 * id the form required.
 *
 * The default matters more than it looks: `awaitingEvidence` defaults to TRUE
 * because the question actually being asked is "which batch have I not yet
 * photographed", and a picker full of already-submitted batches sends someone
 * straight into the one-photo-one-credit refusal.
 * ------------------------------------------------------------------ */

describe("listMatches input", () => {
  it("asks for the batches awaiting a photo by default", () => {
    expect(ListMatchesInput.parse({}).awaitingEvidence).toBe(true);
  });

  it("can be asked for all of them", () => {
    expect(ListMatchesInput.parse({ awaitingEvidence: false }).awaitingEvidence).toBe(false);
  });

  /* A picker is a thumb-sized list, not a report. */
  it("returns a page, not a table", () => {
    expect(ListMatchesInput.parse({}).limit).toBe(25);
    expect(() => ListMatchesInput.parse({ limit: 5000 })).toThrow();
    expect(() => ListMatchesInput.parse({ limit: 0 })).toThrow();
  });
});

describe("a match summary carries what a person recognises", () => {
  const base = {
    matchId: "match_abc", lotId: "lot_abc", unitId: "unit_ldh",
    distanceKm: 31.4, transportKgCo2e: 12.2, assignedTonnes: 4.2,
    decidedAt: "2026-09-12T10:00:00.000Z", rationale: "nearest accepting unit",
  };

  /* Nobody recognises a batch by its id. They recognise the plant and the
     district, which is why those are required rather than optional. */
  it("requires the unit name and the feedstock", () => {
    expect(() => MatchSummary.parse(base)).toThrow();
    const ok = MatchSummary.parse({ ...base, unitName: "Ludhiana Biochar Works", district: "Sangrur", feedstock: "paddy_straw", hasEvidence: false });
    expect(ok.unitName).toBe("Ludhiana Biochar Works");
  });

  /* A reseed has orphaned matches before, so the lot row can be gone. The
     district must be expressible as unknown rather than forcing the skill to
     invent one or drop the match. */
  it("allows an unknown district rather than dropping the match", () => {
    const ok = MatchSummary.parse({ ...base, unitName: "unit_ldh", district: null, feedstock: "mixed", hasEvidence: false });
    expect(ok.district).toBeNull();
  });

  it("says whether evidence already exists, so the picker can warn", () => {
    const ok = MatchSummary.parse({ ...base, unitName: "u", district: null, feedstock: "mixed", hasEvidence: true });
    expect(ok.hasEvidence).toBe(true);
  });

  it("parses an empty list without inventing one", () => {
    expect(ListMatchesOutput.parse({ matches: [] }).matches).toEqual([]);
  });
});
