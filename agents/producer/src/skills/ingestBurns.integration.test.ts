import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { db, schema } from "@charkha/db";
import { readChain } from "@charkha/db/ledger";
import { ingestBurns } from "./ingestBurns.ts";

/* ------------------------------------------------------------------ *
 * Integration tests - these need a real Postgres.
 *
 * firms.test.ts proves the dedupe DECISION (planIngest returns nothing the
 * second time). It cannot prove the dedupe GUARANTEE, because that lives in
 * the transaction, the stable ids and `onConflictDoNothing` - i.e. in
 * Postgres. CI provides a database; locally, `docker compose up -d db &&
 * pnpm db:push` does.
 *
 * Skipped rather than failed when there is no database, so a unit-test run
 * on a laptop without Docker stays green.
 * ------------------------------------------------------------------ */

const url = process.env["DATABASE_URL"];

/**
 * These tests DELETE from burn_detections and residue_lots. Fine against a
 * local or CI database, destructive against one somebody else is using.
 * Same guard as ledger.test.ts - local hosts run freely, anything else needs
 * a deliberate opt-in.
 */
const isLocal = (u: string): boolean => {
  try {
    const host = new URL(u).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "db";
  } catch {
    return false;
  }
};

const canRun = Boolean(url) && (isLocal(url!) || process.env["ALLOW_DESTRUCTIVE_TESTS"] === "1");

if (url && !canRun) {
  console.warn(
    "[ingestBurns.integration] skipping - DATABASE_URL is not local and these tests delete lots.\n" +
      "  If it is YOUR OWN database and nobody else uses it: ALLOW_DESTRUCTIVE_TESTS=1 pnpm test",
  );
}

/** The real SkillContext shape, minus the event bus. */
const ctx = (taskId: string) => ({ taskId, contextId: "test", progress: () => {} });

const lotCount = async () => (await db().select().from(schema.residueLots)).length;
const detectionCount = async () => (await db().select().from(schema.burnDetections)).length;

describe.skipIf(!canRun)("ingestBurns against a real database", () => {
  let cacheDir = "";

  beforeEach(async () => {
    // Pin the feed to the bundled sample: no key, and an empty cache
    // directory. A developer who happens to have a real FIRMS_MAP_KEY set
    // must not have their test run reach out to NASA.
    cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "charkha-ingest-it-"));
    vi.stubEnv("FIRMS_MAP_KEY", "");
    vi.stubEnv("FIRMS_CACHE_DIR", cacheDir);

    const d = db();
    await d.delete(schema.residueLots);
    await d.delete(schema.burnDetections);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(cacheDir, { recursive: true, force: true });
  });

  /* THE DEDUPE GUARANTEE, against real SQL this time. */
  it("creates lots on the first run and none on the second", async () => {
    const first = await ingestBurns({}, ctx("task_ingest_1"));

    expect(first.lotsCreated).toBeGreaterThan(0);
    expect(await lotCount()).toBe(first.lotsCreated);
    expect(await detectionCount()).toBe(first.newDetections);

    const after = await lotCount();
    const second = await ingestBurns({}, ctx("task_ingest_2"));

    expect(second.lotsCreated).toBe(0);
    expect(second.newDetections).toBe(0);
    // The row count is the assertion that matters: same feed, same rows.
    expect(await lotCount()).toBe(after);
  });

  it("gives every lot the detection it came from", async () => {
    await ingestBurns({}, ctx("task_ingest_3"));

    const lots = await db().select().from(schema.residueLots);
    const detectionIds = new Set(
      (await db().select().from(schema.burnDetections)).map((d) => d.detectionId),
    );

    expect(lots.length).toBeGreaterThan(0);
    for (const lot of lots) {
      expect(lot.sourceDetectionId).not.toBeNull();
      expect(detectionIds.has(lot.sourceDetectionId!)).toBe(true);
      expect(lot.tonnes).toBeGreaterThan(0);
      expect(lot.status).toBe("listed");
    }
  });

  /* Rule 5: appendDecision exactly once per meaningful decision. */
  it("appends exactly one decision per ingest, even when it finds nothing", async () => {
    const found = `task_ingest_found_${Date.now()}`;
    await ingestBurns({}, ctx(found));
    expect(await readChain(found)).toHaveLength(1);

    // Second run creates nothing - but we still looked, and the trace should
    // show that we looked.
    const empty = `task_ingest_empty_${Date.now()}`;
    await ingestBurns({}, ctx(empty));
    const chain = await readChain(empty);
    expect(chain).toHaveLength(1);
    expect(chain[0]?.agent).toBe("producer");
    expect(chain[0]?.action).toBe("ingestBurns");
  });
});
