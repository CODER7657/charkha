import { describe, it, expect, beforeEach } from "vitest";
import type { FieldEvidence, Match, VerifyEvidenceOutput } from "@charkha/core";
import { issuerFromSeed } from "../did.ts";
import { memoryStore } from "../memoryStore.ts";
import { makeIssueCredit } from "./issueCredit.ts";
import { makeLookupCredit } from "./lookupCredit.ts";

/* ------------------------------------------------------------------ *
 * Reading a credit changes nothing, and must be seen to change nothing.
 *
 * This is the only registry skill with no consequence, which is the whole
 * reason it can be dispatched without a confirmation. The test that matters
 * is not that it finds a credit - it is that asking leaves no trace in the
 * ledger, because a chain that grows when somebody asks a question is no
 * longer a record of decisions.
 * ------------------------------------------------------------------ */

const issuer = issuerFromSeed("9".repeat(64));
const ctx = { taskId: "task_lookup", contextId: "c", progress: () => {} };

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

const EVIDENCE: FieldEvidence = {
  evidenceId: "evi_1",
  matchId: "mat_1",
  at: { lat: 30.9, lon: 75.85 },
  capturedAt: "2026-09-02T09:30:00.000Z",
  imageHash: "a".repeat(64),
  modelHash: "b".repeat(64),
  modelVersion: "0.1.0-baseline",
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
  modelVersion: "0.1.0-baseline",
  reasons: [],
  methodologyChecks: [],
};

let store: ReturnType<typeof memoryStore>;
let lookupCredit: ReturnType<typeof makeLookupCredit>;

beforeEach(() => {
  store = memoryStore({ matches: [MATCH], evidence: [EVIDENCE], verifications: [ACCEPTED] });
  lookupCredit = makeLookupCredit(store);
});

describe("lookupCredit", () => {
  const issue = () =>
    makeIssueCredit(store, () => issuer)({ matchId: "mat_1", evidenceId: "evi_1" }, ctx);

  it("returns the credit, with everything a holder needs to check it", async () => {
    const { credit } = await issue();

    const found = (await lookupCredit({ creditId: credit.creditId }, ctx)).credit;
    expect(found).not.toBeNull();
    /* The credential and the index are the point: without them a holder
       cannot check the status list for themselves, which is the whole claim. */
    expect(found).toMatchObject({
      creditId: credit.creditId,
      status: "issued",
      holder: credit.holder,
      statusListIndex: credit.statusListIndex,
      credentialJwt: credit.credentialJwt,
    });
  });

  it("answers with null for a credit that does not exist, rather than throwing", async () => {
    /* Deliberate. A throw becomes the registry's English prose in whatever
       language the caller is reading - "no such credit" is an answer, and it
       belongs to the caller to phrase. */
    await expect(lookupCredit({ creditId: "crd_00000000000000000001" }, ctx)).resolves.toEqual({ credit: null });
  });

  it("appends no decision - asking is not deciding", async () => {
    await issue();
    const before = store.decisions.length;

    await lookupCredit({ creditId: store.credits[0]!.creditId }, ctx);
    await lookupCredit({ creditId: "crd_00000000000000000001" }, ctx);
    await lookupCredit({ creditId: store.credits[0]!.creditId }, ctx);

    expect(store.decisions).toHaveLength(before);
  });

  it("changes nothing about the credit it read", async () => {
    const { credit } = await issue();
    const before = JSON.stringify(store.credits);

    await lookupCredit({ creditId: credit.creditId }, ctx);

    expect(JSON.stringify(store.credits)).toBe(before);
  });

  it("reports a retired credit as retired", async () => {
    const { credit } = await issue();
    await store.markRetired(credit.creditId);

    const found = (await lookupCredit({ creditId: credit.creditId }, ctx)).credit;
    expect(found?.status).toBe("retired");
  });
});
