import { describe, it, expect, beforeEach } from "vitest";
import { verifyCredential } from "did-jwt-vc";
import { computeCredit, type FieldEvidence, type Match, type VerifyEvidenceOutput } from "@charkha/core";
import { didResolver, issuerFromSeed } from "../did.ts";
import { memoryStore } from "../memoryStore.ts";
import { makeIssueCredit } from "./issueCredit.ts";

/* ------------------------------------------------------------------ *
 * THE DOUBLE-COUNTING GUARD.
 *
 * Everything else in this repo is decoration if the same batch can be
 * credited twice. This file was written before the implementation.
 * ------------------------------------------------------------------ */

const SEED = "9".repeat(64);
const issuer = issuerFromSeed(SEED);

const MATCH: Match = {
  matchId: "mat_1",
  lotId: "lot_1",
  unitId: "unit_1",
  distanceKm: 42.5,
  transportKgCo2e: 0,
  assignedTonnes: 12,
  decidedAt: "2026-09-01T06:00:00.000Z",
  rationale: "nearest unit with capacity",
};

const EVIDENCE: FieldEvidence = {
  evidenceId: "evi_1",
  matchId: "mat_1",
  at: { lat: 30.901, lon: 75.857 },
  capturedAt: "2026-09-02T09:30:00.000Z",
  imageHash: "a".repeat(64),
  modelHash: "b".repeat(64),
  modelVersion: "charnet-0.3.1",
  clientScores: { biochar: 0.93, ash: 0.05, unburnt: 0.02 },
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
  predictedClass: "biochar",
  confidence: 0.93,
  modelHash: "b".repeat(64),
  modelVersion: "charnet-0.3.1",
  reasons: ["peak temperature within methodology range"],
  methodologyChecks: [{ check: "peakTempC >= 350", passed: true, detail: "520C" }],
};

const ctx = { taskId: "task_1", contextId: "ctx_1", progress: () => {} };
const input = { matchId: "mat_1", evidenceId: "evi_1", verification: ACCEPTED };

let store: ReturnType<typeof memoryStore>;
let issueCredit: ReturnType<typeof makeIssueCredit>;

beforeEach(() => {
  store = memoryStore({ matches: [MATCH], evidence: [EVIDENCE] });
  issueCredit = makeIssueCredit(store, () => issuer);
});

describe("double counting", () => {
  it("refuses a second credit for the same evidenceId", async () => {
    const first = await issueCredit(input, ctx);

    await expect(issueCredit(input, ctx)).rejects.toThrow(/already/i);

    expect(store.credits).toHaveLength(1);
    expect(store.credits[0]!.creditId).toBe(first.credit.creditId);
  });

  it("does not append a second decision for the refused attempt", async () => {
    await issueCredit(input, ctx);
    const after = store.decisions.length;

    await expect(issueCredit(input, ctx)).rejects.toThrow();

    expect(store.decisions).toHaveLength(after);
  });

  it("names the existing credit in the error, so the operator can find it", async () => {
    const first = await issueCredit(input, ctx);
    await expect(issueCredit(input, ctx)).rejects.toThrow(first.credit.creditId);
  });

  it("still refuses when the second attempt arrives on a different task", async () => {
    await issueCredit(input, ctx);
    await expect(issueCredit(input, { ...ctx, taskId: "task_2" })).rejects.toThrow(/already/i);
    expect(store.credits).toHaveLength(1);
  });
});

describe("unverified batches", () => {
  for (const verdict of ["rejected", "needs_review"] as const) {
    it(`issues nothing for a "${verdict}" verdict`, async () => {
      const verification = { ...ACCEPTED, verdict };

      await expect(issueCredit({ ...input, verification }, ctx)).rejects.toThrow(new RegExp(verdict));

      expect(store.credits).toHaveLength(0);
      expect(store.decisions).toHaveLength(0);
    });
  }

  it("refuses when the verification is for a different evidenceId", async () => {
    const verification = { ...ACCEPTED, evidenceId: "evi_somewhere_else" };
    await expect(issueCredit({ ...input, verification }, ctx)).rejects.toThrow(/evidence/i);
    expect(store.credits).toHaveLength(0);
  });

  it("refuses when the evidence is not on the match being credited", async () => {
    await expect(issueCredit({ ...input, matchId: "mat_other" }, ctx)).rejects.toThrow();
    expect(store.credits).toHaveLength(0);
  });
});

describe("the credit itself", () => {
  it("uses the real transport distance and the verifier's quality score", async () => {
    const { credit } = await issueCredit(input, ctx);

    const expected = computeCredit({
      feedstockTonnes: MATCH.assignedTonnes,
      biocharTonnes: EVIDENCE.batch.outputTonnes,
      transportKm: MATCH.distanceKm,
      qualityScore: ACCEPTED.charQualityScore,
    });

    expect(credit.netTonnesCo2e).toBe(expected.netTonnesCo2e);
    expect(credit.breakdown).toEqual({
      grossSequestrationTco2e: expected.grossSequestrationTco2e,
      transportDebitTco2e: expected.transportDebitTco2e,
      processDebitTco2e: expected.processDebitTco2e,
    });
    expect(credit.breakdown.transportDebitTco2e).toBeGreaterThan(0);
  });

  it("appends exactly one decision, carrying the model hash and confidence", async () => {
    await issueCredit(input, ctx);

    expect(store.decisions).toHaveLength(1);
    const [decision] = store.decisions;
    expect(decision).toMatchObject({
      agent: "registry",
      action: "issueCredit",
      taskId: "task_1",
      modelHash: ACCEPTED.modelHash,
      confidence: ACCEPTED.confidence,
    });
  });

  it("signs a credential that verifies against the issuer DID", async () => {
    const { credit } = await issueCredit(input, ctx);

    const verified = await verifyCredential(credit.credentialJwt, didResolver);
    expect(verified.verified).toBe(true);
    expect(verified.issuer).toBe(issuer.did);
    expect(credit.issuerDid).toBe(issuer.did);
  });

  it("states the three evidence classes and the model that made the call", async () => {
    const { credit } = await issueCredit(input, ctx);
    const subject = (await verifyCredential(credit.credentialJwt, didResolver)).verifiableCredential
      .credentialSubject as Record<string, Record<string, unknown>>;

    // production evidence - what was made, and how
    expect(subject["productionEvidence"]).toMatchObject({
      pyrolysisPeakTempC: 520,
      residenceTimeMin: 45,
      feedstock: "paddy_straw",
      biocharTonnes: 3.2,
    });
    // application evidence - where it went, and how much
    expect(subject["applicationEvidence"]).toMatchObject({
      gps: { lat: 30.901, lon: 75.857 },
      feedstockTonnes: 12,
    });
    // chain of custody - the ledger head at the moment of issuance
    expect(subject["chainOfCustody"]).toMatchObject({ decisionLogHash: expect.any(String) });
    expect(subject["model"]).toMatchObject({
      modelHash: ACCEPTED.modelHash,
      modelVersion: ACCEPTED.modelVersion,
    });
  });

  it("points the credential at a status list so a holder can check it themselves", async () => {
    const { credit } = await issueCredit(input, ctx);
    const vc = (await verifyCredential(credit.credentialJwt, didResolver)).verifiableCredential as Record<string, unknown>;

    expect(vc["credentialStatus"]).toMatchObject({
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: "0",
    });
  });

  it("issues as live, not retired", async () => {
    const { credit } = await issueCredit(input, ctx);
    expect(credit.status).toBe("issued");
  });
});
