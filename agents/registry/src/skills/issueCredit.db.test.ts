import { describe, it, expect, beforeEach } from "vitest";
import { db, schema } from "@charkha/db";
import { readChain, nextStatusListIndex } from "@charkha/db/ledger";
import type { FieldEvidence, Match, VerifyEvidenceOutput } from "@charkha/core";
import { issuerFromSeed } from "../did.ts";
import { dbStore } from "../store.ts";
import { makeIssueCredit } from "./issueCredit.ts";

/**
 * Integration test - needs a real Postgres, because the guarantee being tested
 * is enforced by Postgres, not by our code. The pre-check in issueCredit reads
 * and then inserts; only the unique index on credits.evidence_id holds when
 * two requests are in flight at once, or when two registry processes are.
 *
 * CI provides a database; locally, `docker compose up -d db && pnpm db:push`.
 * Skipped rather than failed without one, so a laptop run stays green.
 */
const url = process.env["DATABASE_URL"];

/** These tests delete from credits and decision_log - only ever do that to a local database. */
const isLocal = (u: string): boolean => {
  try {
    const host = new URL(u).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "db";
  } catch {
    return false;
  }
};

const canRun = Boolean(url) && (isLocal(url!) || process.env["ALLOW_DESTRUCTIVE_TESTS"] === "1");

const MATCH: Match = {
  matchId: "mat_race",
  lotId: "lot_race",
  unitId: "unit_race",
  distanceKm: 42.5,
  transportKgCo2e: 71.4,
  assignedTonnes: 12,
  decidedAt: "2026-09-10T06:00:00.000Z",
  rationale: "nearest unit with capacity",
};

const EVIDENCE: FieldEvidence = {
  evidenceId: "evi_race",
  matchId: "mat_race",
  at: { lat: 30.901, lon: 75.857 },
  capturedAt: "2026-09-10T09:30:00.000Z",
  imageHash: "a".repeat(64),
  modelHash: "b".repeat(64),
  modelVersion: "charnet-0.3.1",
  clientScores: { biochar: 0.93 },
  batch: {
    pyrolysisPeakTempC: 520,
    residenceTimeMin: 45,
    feedstock: "paddy_straw",
    outputTonnes: 3.2,
    hcOrgRatio: 0.32,
  },
};

const ACCEPTED: VerifyEvidenceOutput = {
  evidenceId: "evi_race",
  verdict: "accepted",
  charQualityScore: 0.88,
  predictedClass: "biochar",
  confidence: 0.93,
  modelHash: "b".repeat(64),
  modelVersion: "charnet-0.3.1",
  reasons: ["peak temperature within methodology range"],
  methodologyChecks: [{ check: "peakTempC >= 350", passed: true, detail: "520C" }],
};

/**
 * Hold every caller at the same point until all of them have arrived.
 *
 * Left to chance, the interleaving that breaks the guard only sometimes
 * happens - a flaky concurrency test passes in CI while the bug is live. This
 * makes the window deterministic: every request completes its pre-check
 * before any of them inserts, which is exactly the state a real race puts
 * them in, and then only the database can refuse the duplicates.
 */
const barrier = (n: number) => {
  let arrived = 0;
  let open: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  return async () => {
    if (++arrived >= n) open();
    await gate;
  };
};

describe.skipIf(!canRun)("double counting, against the database", () => {
  const issuer = () => issuerFromSeed("9".repeat(64));
  const issueCredit = makeIssueCredit(dbStore(), issuer);
  const input = { matchId: "mat_race", evidenceId: "evi_race" };

  beforeEach(async () => {
    const d = db();
    await d.delete(schema.credits);
    await d.delete(schema.decisionLog);
    await d.delete(schema.verifications);
    await d.delete(schema.evidence);
    await d.delete(schema.matches);
    await d.delete(schema.residueLots);
    /* A credit is held by the producer of the lot behind the match, so the lot
       has to exist: no lot, no holder, no credit. */
    await d.insert(schema.residueLots).values({
      lotId: MATCH.lotId,
      producerId: "prod_race",
      lat: 30.5,
      lon: 76.0,
      district: "Test",
      feedstock: "paddy_straw",
      tonnes: MATCH.assignedTonnes,
      availableFrom: new Date(MATCH.decidedAt),
      sourceDetectionId: null,
      status: "matched",
    });
    await d.insert(schema.matches).values({
      ...MATCH,
      decidedAt: new Date(MATCH.decidedAt),
      taskId: "task_seed",
    });
    await d.insert(schema.evidence).values({
      evidenceId: EVIDENCE.evidenceId,
      matchId: EVIDENCE.matchId,
      lat: EVIDENCE.at.lat,
      lon: EVIDENCE.at.lon,
      capturedAt: new Date(EVIDENCE.capturedAt),
      imageHash: EVIDENCE.imageHash,
      modelHash: EVIDENCE.modelHash,
      modelVersion: EVIDENCE.modelVersion,
      clientScores: EVIDENCE.clientScores,
      batch: EVIDENCE.batch,
    });
    // The verdict the registry reads. Written by the verifier in real life.
    await d.insert(schema.verifications).values({ ...ACCEPTED, taskId: "task_seed" });
  });

  /**
   * THE test. Without the unique index this fails: every request passes the
   * pre-check before any of them inserts, and the same batch is credited N
   * times - each credit individually valid, each ledger entry hashing
   * correctly, so nothing downstream can tell that it happened.
   */
  it("issues exactly one credit for 10 concurrent requests on the same evidence", async () => {
    const n = 10;

    // Every request looks, finds nothing, and only then does any of them insert.
    const base = dbStore();
    const waitForEveryone = barrier(n);
    const racing = makeIssueCredit(
      {
        ...base,
        findCreditByEvidenceId: async (evidenceId) => {
          const found = await base.findCreditByEvidenceId(evidenceId);
          await waitForEveryone();
          return found;
        },
      },
      issuer,
    );

    const results = await Promise.allSettled(
      Array.from({ length: n }, (_, i) => racing(input, { taskId: `task_${i}`, contextId: "c", progress: () => {} })),
    );

    const issued = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r) => r.status === "rejected");

    expect(issued).toHaveLength(1);
    expect(refused).toHaveLength(n - 1);

    // Every one of them lost at the insert, so every refusal came from the database.
    for (const r of refused) {
      expect(String((r as PromiseRejectedResult).reason)).toMatch(/already been credited/i);
    }

    const rows = await db().select().from(schema.credits);
    expect(rows).toHaveLength(1);

    // And the ledger records the one issuance, not ten.
    const chain = await readChain();
    expect(chain.filter((r) => r.action === "issueCredit")).toHaveLength(1);
  });

  it("still refuses a later sequential attempt", async () => {
    const first = await issueCredit(input, { taskId: "task_a", contextId: "c", progress: () => {} });

    await expect(
      issueCredit(input, { taskId: "task_b", contextId: "c", progress: () => {} }),
    ).rejects.toThrow(first.credit.creditId);

    expect(await db().select().from(schema.credits)).toHaveLength(1);
  });

  /* A credit is held by the producer of the lot behind the match. */
  it("sets holder to the producer of the lot behind the match", async () => {
    const { credit } = await issueCredit(
      { matchId: "mat_race", evidenceId: "evi_race" },
      { taskId: "task_holder", contextId: "c", progress: () => {} },
    );
    expect(credit.holder).toBe("prod_race");
  });

  it("refuses when the lot behind the match is gone - no holder, no credit", async () => {
    await db().delete(schema.residueLots);
    await expect(
      issueCredit(
        { matchId: "mat_race", evidenceId: "evi_race" },
        { taskId: "task_nolot", contextId: "c", progress: () => {} },
      ),
    ).rejects.toThrow(/no holder/i);
  });

});

/* ------------------------------------------------------------------ *
 * Status-list index allocation, against the database.
 *
 * The credential COMMITS to this number before it is signed. Two credentials
 * sharing an index means retiring one sets the bit the other points at, so the
 * retired credit keeps verifying as live under our own signature. Only the
 * database can make the allocation atomic, so only the database can test it.
 * ------------------------------------------------------------------ */
describe.skipIf(!canRun)("status list indices are unique under concurrency", () => {
  it("gives 20 concurrent allocations 20 distinct indices", async () => {
    const indices = await Promise.all(Array.from({ length: 20 }, () => nextStatusListIndex()));
    expect(new Set(indices).size).toBe(20);
  });

  it("never goes backwards", async () => {
    const a = await nextStatusListIndex();
    const b = await nextStatusListIndex();
    expect(b).toBeGreaterThan(a);
  });
});
