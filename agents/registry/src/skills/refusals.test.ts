import { describe, it, expect } from "vitest";
import { isCallerError } from "@charkha/a2a";
import type { FieldEvidence, Match, VerifyEvidenceOutput } from "@charkha/core";
import { issuerFromSeed } from "../did.ts";
import { memoryStore } from "../memoryStore.ts";
import { makeIssueCredit } from "./issueCredit.ts";
import { makeRetireCredit } from "./retireCredit.ts";

/* ------------------------------------------------------------------ *
 * EVERY REFUSAL IS THE CALLER'S FAULT, AND MUST BE REPORTED AS ONE.
 *
 * The gateway returns 400 for a refusal and 500 for a fault, and it decides
 * which by matching the message text (`isCallerError` in packages/a2a). That
 * makes the status code depend on our PROSE: reword a refusal out of the
 * pattern and it silently becomes a 500 - a working guard that looks like an
 * outage, in front of a judge, with nothing failing in CI.
 *
 * So this file does not assert any particular wording. It provokes each
 * refusal for real and asserts only that the message it throws still
 * classifies as a caller error. Reword freely; drop out of the pattern and
 * this goes red.
 * ------------------------------------------------------------------ */

const issuer = issuerFromSeed("9".repeat(64));
const ctx = { taskId: "task_refusal", contextId: "c", progress: () => {} };

const MATCH: Match = {
  matchId: "mat_1",
  lotId: "lot_1",
  unitId: "unit_1",
  distanceKm: 40,
  transportKgCo2e: 0,
  assignedTonnes: 12,
  decidedAt: "2026-09-01T06:00:00.000Z",
  rationale: "nearest unit",
};

const OTHER_MATCH: Match = { ...MATCH, matchId: "mat_2", lotId: "lot_2" };

const EVIDENCE: FieldEvidence = {
  evidenceId: "evi_1",
  matchId: "mat_1",
  at: { lat: 30.9, lon: 75.85 },
  capturedAt: "2026-09-02T09:30:00.000Z",
  imageHash: "a".repeat(64),
  modelHash: "b".repeat(64),
  modelVersion: "charnet-0.3.1",
  clientScores: { good_char: 0.93 },
  batch: {
    pyrolysisPeakTempC: 520,
    residenceTimeMin: 45,
    feedstock: "paddy_straw",
    outputTonnes: 3.2,
    hcOrgRatio: 0.32,
  },
};

const ACCEPTED: VerifyEvidenceOutput = {
  evidenceId: "evi_1",
  verdict: "accepted",
  charQualityScore: 0.88,
  predictedClass: "good_char",
  confidence: 0.93,
  modelHash: "b".repeat(64),
  modelVersion: "charnet-0.3.1",
  reasons: [],
  methodologyChecks: [],
};

/** Run something that must be refused and hand back the message it threw. */
const refusalFrom = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error("expected a refusal, but the call succeeded");
};

describe("every issuance refusal reports as a caller error", () => {
  const full = () =>
    memoryStore({ matches: [MATCH, OTHER_MATCH], evidence: [EVIDENCE], verifications: [ACCEPTED] });

  it("no verification on record", async () => {
    const store = memoryStore({ matches: [MATCH], evidence: [EVIDENCE] });
    const msg = await refusalFrom(() =>
      makeIssueCredit(store, () => issuer)({ matchId: "mat_1", evidenceId: "evi_1" }, ctx),
    );
    expect(isCallerError(msg), msg).toBe(true);
  });

  for (const verdict of ["rejected", "needs_review"] as const) {
    it(`a "${verdict}" verdict`, async () => {
      const store = memoryStore({
        matches: [MATCH],
        evidence: [EVIDENCE],
        verifications: [{ ...ACCEPTED, verdict }],
      });
      const msg = await refusalFrom(() =>
        makeIssueCredit(store, () => issuer)({ matchId: "mat_1", evidenceId: "evi_1" }, ctx),
      );
      expect(isCallerError(msg), msg).toBe(true);
    });
  }

  it("a second credit for the same evidence", async () => {
    const store = full();
    const issue = makeIssueCredit(store, () => issuer);
    await issue({ matchId: "mat_1", evidenceId: "evi_1" }, ctx);
    const msg = await refusalFrom(() => issue({ matchId: "mat_1", evidenceId: "evi_1" }, ctx));
    expect(isCallerError(msg), msg).toBe(true);
  });

  it("evidence that does not exist", async () => {
    const store = memoryStore({ matches: [MATCH], verifications: [{ ...ACCEPTED, evidenceId: "evi_ghost" }] });
    const msg = await refusalFrom(() =>
      makeIssueCredit(store, () => issuer)({ matchId: "mat_1", evidenceId: "evi_ghost" }, ctx),
    );
    expect(isCallerError(msg), msg).toBe(true);
  });

  it("a match that does not exist", async () => {
    const msg = await refusalFrom(() =>
      makeIssueCredit(full(), () => issuer)({ matchId: "mat_ghost", evidenceId: "evi_1" }, ctx),
    );
    expect(isCallerError(msg), msg).toBe(true);
  });

  it("evidence that belongs to a different match", async () => {
    const msg = await refusalFrom(() =>
      makeIssueCredit(full(), () => issuer)({ matchId: "mat_2", evidenceId: "evi_1" }, ctx),
    );
    expect(isCallerError(msg), msg).toBe(true);
  });

  it("a match whose lot has no producer to hold the credit", async () => {
    const store = memoryStore({
      matches: [MATCH],
      evidence: [EVIDENCE],
      verifications: [ACCEPTED],
      lotProducers: {},
    });
    // No producer for this lot: issuance must refuse rather than invent a holder.
    const noHolder = { ...store, findLotProducer: async () => null };
    const msg = await refusalFrom(() =>
      makeIssueCredit(noHolder, () => issuer)({ matchId: "mat_1", evidenceId: "evi_1" }, ctx),
    );
    expect(isCallerError(msg), msg).toBe(true);
  });
});

describe("every retirement refusal reports as a caller error", () => {
  const issued = async () => {
    const store = memoryStore({ matches: [MATCH], evidence: [EVIDENCE], verifications: [ACCEPTED] });
    const { credit } = await makeIssueCredit(store, () => issuer)(
      { matchId: "mat_1", evidenceId: "evi_1" },
      ctx,
    );
    return { store, credit };
  };

  it("a credit that does not exist", async () => {
    const { store } = await issued();
    const msg = await refusalFrom(() =>
      makeRetireCredit(store)({ creditId: "crd_ghost", retiredBy: "whoever", reason: "x" }, ctx),
    );
    expect(isCallerError(msg), msg).toBe(true);
  });

  it("a caller who is not the holder", async () => {
    const { store, credit } = await issued();
    const msg = await refusalFrom(() =>
      makeRetireCredit(store)(
        { creditId: credit.creditId, retiredBy: "not-the-holder", reason: "x" },
        ctx,
      ),
    );
    expect(isCallerError(msg), msg).toBe(true);
  });
});
