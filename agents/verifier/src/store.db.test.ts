import { describe, it, expect, beforeEach } from "vitest";
import { db, schema, eq, inArray } from "@charkha/db";
import type { FieldEvidence } from "@charkha/core";
import { claimEvidence, findByImageHash } from "./store.ts";
import { DuplicatePhotoError } from "./skills/verifyEvidence.ts";

/**
 * Integration test - needs a real Postgres, because the guarantee being tested
 * is enforced by Postgres and nowhere else.
 *
 * The skill reads `findByImageHash` and then inserts. That read-then-write
 * cannot hold when two submissions of the same photo are in flight at once:
 * both reads return nothing, both proceed, and the second credit is minted
 * from a photograph that was already paid for. Only the unique index decides
 * it, so only a test with a database can prove it.
 *
 * CI provides a database; locally, `docker compose up -d db && pnpm db:push`.
 * Skipped rather than failed without one, so a laptop run stays green.
 */
const url = process.env["DATABASE_URL"];

/** This test deletes from evidence - only ever against a local database. */
const isLocal = (u: string): boolean => {
  try {
    const host = new URL(u).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "db";
  } catch {
    return false;
  }
};

const canRun = Boolean(url) && (isLocal(url!) || process.env["ALLOW_DESTRUCTIVE_TESTS"] === "1");

const PHOTO = "d".repeat(64);
const IDS = ["evi_dup_0", "evi_dup_1", "evi_dup_2", "evi_dup_3", "evi_dup_4"];

const evidence = (over: Partial<FieldEvidence> = {}): FieldEvidence => ({
  evidenceId: "evi_dup_0",
  matchId: "mat_dup_0",
  at: { lat: 30.901, lon: 75.857 },
  capturedAt: "2026-09-10T09:30:00.000Z",
  imageHash: PHOTO,
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
  ...over,
});

describe.runIf(canRun)("evidence.image_hash is unique in the database", () => {
  beforeEach(async () => {
    await db().delete(schema.evidence).where(inArray(schema.evidence.evidenceId, IDS));
    await db().delete(schema.evidence).where(eq(schema.evidence.imageHash, PHOTO));
  });

  it("refuses the same photo under a second evidence id", async () => {
    expect(await claimEvidence(evidence(), "task_0")).toBe(true);

    await expect(
      claimEvidence(evidence({ evidenceId: "evi_dup_1", matchId: "mat_dup_1" }), "task_1"),
    ).rejects.toThrow(DuplicatePhotoError);
  });

  it("names the evidence that already used the photo", async () => {
    await claimEvidence(evidence(), "task_0");
    await expect(
      claimEvidence(evidence({ evidenceId: "evi_dup_1", matchId: "mat_dup_1" }), "task_1"),
    ).rejects.toThrow(/evi_dup_0.*mat_dup_0/);
  });

  /* A retry of the same submission is a lost race, not a refusal - the field
     queue replays it offline and the skill returns the recorded verdict. The
     two must stay distinguishable: same id is `false`, same photo throws. */
  it("re-claiming the same evidence id returns false rather than refusing", async () => {
    expect(await claimEvidence(evidence(), "task_0")).toBe(true);
    expect(await claimEvidence(evidence(), "task_0")).toBe(false);
  });

  /* The one the pre-check cannot do. Five submissions of one photograph under
     five different ids, all in flight together: every read sees an empty
     table, so the index is the only thing standing between us and five
     credits for one pile. */
  it("lets exactly one of five concurrent claims on one photo through", async () => {
    const results = await Promise.allSettled(
      IDS.map((evidenceId, i) =>
        claimEvidence(evidence({ evidenceId, matchId: `mat_dup_${i}` }), `task_${i}`),
      ),
    );

    const won = results.filter((r) => r.status === "fulfilled" && r.value === true);
    const refused = results.filter(
      (r) => r.status === "rejected" && r.reason instanceof DuplicatePhotoError,
    );

    expect(won).toHaveLength(1);
    expect(refused).toHaveLength(4);

    const rows = await db().select().from(schema.evidence).where(eq(schema.evidence.imageHash, PHOTO));
    expect(rows).toHaveLength(1);
  });

  it("finds the row that used a photo, and nothing for one that is unused", async () => {
    await claimEvidence(evidence(), "task_0");
    expect(await findByImageHash(PHOTO)).toEqual({ evidenceId: "evi_dup_0", matchId: "mat_dup_0" });
    expect(await findByImageHash("e".repeat(64))).toBeNull();
  });
});
