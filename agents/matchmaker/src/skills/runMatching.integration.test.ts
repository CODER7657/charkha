import { describe, it, expect, beforeEach } from "vitest";
import { db, schema } from "@charkha/db";
import { readChain } from "@charkha/db/ledger";
import { runMatching } from "./runMatching.ts";

/* ------------------------------------------------------------------ *
 * Integration tests - these need a real Postgres.
 *
 * matching.test.ts drives `assign()` directly and proves the algorithm.
 * It cannot prove the three things that only exist in the database:
 *
 *   - a placed lot actually leaves the round as "matched"
 *   - a unit is not handed its full daily capacity again by a second round
 *   - exactly one decision is appended per round
 *
 * CI provides a database; locally, `docker compose up -d db && pnpm db:push`.
 * ------------------------------------------------------------------ */

const url = process.env["DATABASE_URL"];

/** Same guard as ledger.test.ts: these tests delete lots, matches and units. */
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
    "[runMatching.integration] skipping - DATABASE_URL is not local and these tests delete rows.\n" +
      "  If it is YOUR OWN database and nobody else uses it: ALLOW_DESTRUCTIVE_TESTS=1 pnpm test",
  );
}

const ctx = (taskId: string) => ({ taskId, contextId: "test", progress: () => {} });

/** Ludhiana, so a lot placed on top of it is comfortably inside any radius. */
const LUDHIANA = { lat: 30.901, lon: 75.857 };

const seedUnit = async (capacityTonnesPerDay: number) => {
  await db().insert(schema.conversionUnits).values({
    unitId: "unit_it",
    name: "Integration Test Unit",
    lat: LUDHIANA.lat,
    lon: LUDHIANA.lon,
    capacityTonnesPerDay,
    accepts: ["paddy_straw", "wheat_straw", "mixed"],
  });
};

const seedLot = async (lotId: string, tonnes: number) => {
  await db().insert(schema.residueLots).values({
    lotId,
    producerId: "prod_it",
    lat: LUDHIANA.lat,
    lon: LUDHIANA.lon,
    district: "Ludhiana",
    feedstock: "paddy_straw",
    tonnes,
    availableFrom: new Date(),
    sourceDetectionId: null,
    status: "listed",
  });
};

const lotStatus = async (lotId: string): Promise<string | undefined> => {
  const rows = await db().select().from(schema.residueLots);
  return rows.find((r) => r.lotId === lotId)?.status;
};

describe.skipIf(!canRun)("runMatching against a real database", () => {
  beforeEach(async () => {
    const d = db();
    await d.delete(schema.matches);
    await d.delete(schema.residueLots);
    await d.delete(schema.conversionUnits);
  });

  it("moves a placed lot from listed to matched and records the rationale", async () => {
    await seedUnit(45);
    await seedLot("lot_it_a", 10);

    const out = await runMatching({ maxRadiusKm: 60 }, ctx("task_match_1"));

    expect(out.matches).toHaveLength(1);
    expect(out.unmatchedLotIds).toHaveLength(0);
    expect(await lotStatus("lot_it_a")).toBe("matched");

    const [match] = await db().select().from(schema.matches);
    expect(match?.lotId).toBe("lot_it_a");
    expect(match?.unitId).toBe("unit_it");
    expect(match?.rationale).toMatch(/capacity free/);
    // The task id has to thread through, or the trace cannot be assembled.
    expect(match?.taskId).toBe("task_match_1");
  });

  it("does not reassign a lot it already matched", async () => {
    await seedUnit(45);
    await seedLot("lot_it_a", 10);

    await runMatching({ maxRadiusKm: 60 }, ctx("task_match_2a"));
    const second = await runMatching({ maxRadiusKm: 60 }, ctx("task_match_2b"));

    expect(second.matches).toHaveLength(0);
    expect((await db().select().from(schema.matches)).length).toBe(1);
  });

  /* THE CAPACITY GUARANTEE. Capacity is per day, not per round - this is the
     bug that would have fired the second time anyone clicked "Run matching". */
  it("does not hand a unit its full daily capacity again on a second round", async () => {
    await seedUnit(45);
    await seedLot("lot_it_big", 30);

    const first = await runMatching({ maxRadiusKm: 60 }, ctx("task_match_3a"));
    expect(first.matches).toHaveLength(1);

    // 30 of 45 t is now committed today. A second 30 t lot must not fit.
    await seedLot("lot_it_second", 30);
    const second = await runMatching({ maxRadiusKm: 60 }, ctx("task_match_3b"));

    expect(second.matches).toHaveLength(0);
    expect(second.unmatchedLotIds).toEqual(["lot_it_second"]);
    expect(await lotStatus("lot_it_second")).toBe("listed");

    // ...but one that fits in the remaining 15 t still goes.
    await seedLot("lot_it_small", 12);
    const third = await runMatching({ maxRadiusKm: 60 }, ctx("task_match_3c"));
    expect(third.matches.map((m) => m.lotId)).toEqual(["lot_it_small"]);
  });

  it("appends exactly one decision per round", async () => {
    await seedUnit(45);
    await seedLot("lot_it_a", 10);

    const taskId = `task_match_ledger_${Date.now()}`;
    await runMatching({ maxRadiusKm: 60 }, ctx(taskId));

    const chain = await readChain(taskId);
    expect(chain).toHaveLength(1);
    expect(chain[0]?.agent).toBe("matchmaker");
    expect(chain[0]?.action).toBe("runMatching");
  });

  it("refuses a round with no conversion units at all", async () => {
    await seedLot("lot_it_a", 10);

    await expect(runMatching({ maxRadiusKm: 60 }, ctx("task_match_4"))).rejects.toThrow(
      /no conversion units/,
    );
  });
});
