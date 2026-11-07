import { describe, it, expect, beforeEach } from "vitest";
import { db, schema, eq } from "@charkha/db";
import { appendDecision, readChain, verifyLedger } from "@charkha/db/ledger";
import { hashPayload, type DeclareWasteInput } from "@charkha/core";
import { declareWaste } from "./declareWaste.ts";
import { listLots } from "./listLots.ts";
import { ingestBurns } from "./ingestBurns.ts";
/* Reaching into the matchmaker by relative path, on purpose and only from a
   test. The guarantee being checked is the PRODUCER's - that a declared lot
   behaves like a lot downstream - so the test belongs here, and the only way
   to check it is to run a real round. Both agents are mine and both already
   depend on the same three workspace packages, so nothing new is being
   coupled; if this ever needs to cross into somebody else's agent, it wants
   scripts/e2e.mjs and the gateway instead. */
import { runMatching } from "../../../matchmaker/src/skills/runMatching.ts";

/* ------------------------------------------------------------------ *
 * Integration tests - these need a real Postgres.
 *
 * declare.test.ts proves the DECISIONS a declaration produces. It cannot
 * prove that a declared lot is a lot: that it stores, reads back through
 * listLots as declared, appends exactly one ledger record, and leaves the
 * chain valid. All of that lives in Postgres. CI provides a database;
 * locally, `docker compose up -d db && pnpm db:push` does.
 *
 * Skipped rather than failed when there is no database, so a unit-test run on
 * a laptop without Docker stays green.
 * ------------------------------------------------------------------ */

const url = process.env["DATABASE_URL"];

/**
 * These tests DELETE from residue_lots. Fine against a local or CI database,
 * destructive against one somebody else is using. Same guard as the other
 * database suites: local hosts run freely, anything else is a deliberate
 * opt-in.
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
    "[declareWaste.integration] skipping - DATABASE_URL is not local and these tests delete lots.\n" +
      "  If it is YOUR OWN database and nobody else uses it: ALLOW_DESTRUCTIVE_TESTS=1 pnpm test",
  );
}

/** The real SkillContext shape, minus the event bus. */
const ctx = (taskId: string) => ({ taskId, contextId: "test", progress: () => {} });

const declaration: DeclareWasteInput = {
  declaredBy: "Ward 7, Ludhiana Municipal Corporation",
  feedstock: "mixed",
  tonnes: 4.5,
  at: { lat: 30.9, lon: 75.86 },
  district: "Ludhiana",
  note: "wet, collect within 3 days",
};

const rowFor = async (lotId: string) =>
  (await db().select().from(schema.residueLots).where(eq(schema.residueLots.lotId, lotId)))[0];

describe.skipIf(!canRun)("declareWaste against a real database", () => {
  beforeEach(async () => {
    /* burn_detections too, not just the lots.
    
       Ingest dedupes against burn_detections, NOT against residue_lots - that
       is the whole point of keeping detections separately, so a re-run creates
       nothing the second time. Clearing only the lots left every detection
       still "already seen", so `ingestBurns` produced zero lots and the
       both-paths test below failed with "expected 1 to be greater than 1" -
       a message that reads like declared and detected got confused, when
       nothing of the sort happened.
    
       It passed in CI because CI starts from an empty database, so the 20
       fixture rows were new there. It failed for anyone who had ever run
       ingest locally, which is everyone who has used this repo. A test whose
       result depends on how much history the developer's database happens to
       carry is not testing what it says it tests. */
    const d = db();
    await d.delete(schema.residueLots);
    await d.delete(schema.burnDetections);
  });

  /* THE HAPPY PATH, exactly as the issue states it: a municipality declares
     4.5 t of mixed waste and gets a lot that is honestly labelled. */
  it("records a municipality's declaration as a lot", async () => {
    const taskId = `task_declare_${Date.now()}`;
    const { lot } = await declareWaste(declaration, ctx(taskId));

    const row = await rowFor(lot.lotId);
    expect(row).toBeDefined();
    expect(row!.origin).toBe("declared");
    expect(row!.sourceDetectionId).toBeNull();
    expect(row!.tonnes).toBe(4.5);
    expect(row!.feedstock).toBe("mixed");
    expect(row!.district).toBe("Ludhiana");
    expect(row!.status).toBe("listed");
    // The credit this lot eventually earns is held by whoever declared it.
    expect(row!.producerId).toBe("decl_ward_7_ludhiana_municipal_corporation");
  });

  /* The lot that comes back and the row that was written must be the same
     thing. Returning one shape and storing another is how a caller ends up
     trusting a field nobody persisted. */
  it("returns the lot it actually stored", async () => {
    const { lot } = await declareWaste(declaration, ctx(`task_declare_echo_${Date.now()}`));
    const row = await rowFor(lot.lotId);

    expect(row!.lat).toBe(lot.at.lat);
    expect(row!.lon).toBe(lot.at.lon);
    expect(row!.availableFrom.toISOString()).toBe(lot.availableFrom);
    expect(row!.producerId).toBe(lot.producerId);
  });

  /* Rule 5: exactly one appendDecision per meaningful decision. Two records
     for one declaration would double it in the trace; an UPDATE would break
     the chain, which is why nothing here ever writes decision_log twice. */
  it("appends exactly one ledger record, and leaves the chain valid", async () => {
    const taskId = `task_declare_ledger_${Date.now()}`;
    await declareWaste(declaration, ctx(taskId));

    const chain = await readChain(taskId);
    expect(chain).toHaveLength(1);
    expect(chain[0]?.agent).toBe("producer");
    expect(chain[0]?.action).toBe("declareWaste");

    expect((await verifyLedger()).valid).toBe(true);
  });

  /* The note is the declarer's own words and it must be committed to, not
     summarised away. It cannot be READ back today - decision_log stores
     hashes and residue_lots has no note column - but it is inside inputHash,
     so an auditor holding the declaration can prove it is the one that was
     made, and a different note cannot be substituted after the fact. Raised
     on #63; the moment there is a column, this test gets a stronger sibling. */
  it("commits to the declarer's note, verbatim and tamper-evidently", async () => {
    const taskId = `task_declare_note_${Date.now()}`;
    await declareWaste(declaration, ctx(taskId));

    const [record] = await readChain(taskId);
    expect(record!.inputHash).toBe(hashPayload(declaration));

    // Change one word of the note and the record no longer matches.
    const edited = { ...declaration, note: "dry, collect whenever" };
    expect(record!.inputHash).not.toBe(hashPayload(edited));
  });

  /* Both directions, because the whole point is that these two cannot be
     confused. One test, both paths, in one database. */
  it("never confuses a declared lot with a detected one", async () => {
    await declareWaste(declaration, ctx(`task_declare_both_${Date.now()}`));
    await ingestBurns({}, ctx(`task_ingest_both_${Date.now()}`));

    const rows = await db().select().from(schema.residueLots);
    expect(rows.length).toBeGreaterThan(1);

    const declared = rows.filter((r) => r.origin === "declared");
    const detected = rows.filter((r) => r.origin === "detected");
    expect(declared.length).toBe(1);
    expect(detected.length).toBeGreaterThan(0);

    for (const r of declared) expect(r.sourceDetectionId).toBeNull();
    for (const r of detected) expect(r.sourceDetectionId).not.toBeNull();
    // No third state: every row says which path it came in by.
    expect(declared.length + detected.length).toBe(rows.length);
  });

  /* A reader that cannot tell the two apart is the blur this column exists
     to prevent, so the skill that every consumer reads lots through has to
     carry it. */
  it("shows the origin through listLots, where anyone downstream reads it", async () => {
    const { lot } = await declareWaste(declaration, ctx(`task_declare_list_${Date.now()}`));

    const { lots } = await listLots({ limit: 100 }, ctx("task_list"));
    const found = lots.find((l) => l.lotId === lot.lotId);

    expect(found).toBeDefined();
    expect(found!.origin).toBe("declared");
    expect(found!.sourceDetectionId).toBeNull();
  });

  it("defaults availableFrom to now, and honours one that was given", async () => {
    const before = Date.now();
    const { lot: now } = await declareWaste(declaration, ctx(`task_declare_now_${Date.now()}`));
    expect(new Date(now.availableFrom).getTime()).toBeGreaterThanOrEqual(before - 1000);

    const when = "2026-09-15T06:00:00.000Z";
    const { lot: later } = await declareWaste(
      { ...declaration, availableFrom: when },
      ctx(`task_declare_when_${Date.now()}`),
    );
    expect(later.availableFrom).toBe(when);
    expect((await rowFor(later.lotId))!.availableFrom.toISOString()).toBe(when);
  });

  /* Two declarations are two lots, but one declarer. The registry reads
     producerId as the credential holder, so a body that declares on Monday
     and again on Tuesday must own both credits - not one each under two
     identities it cannot prove it controls. */
  it("gives one declarer one identity across separate declarations", async () => {
    const a = await declareWaste(declaration, ctx(`task_declare_a_${Date.now()}`));
    const b = await declareWaste(
      { ...declaration, tonnes: 2.1, declaredBy: "  ward-7, LUDHIANA municipal corporation  " },
      ctx(`task_declare_b_${Date.now()}`),
    );

    expect(a.lot.lotId).not.toBe(b.lot.lotId);
    expect(a.lot.producerId).toBe(b.lot.producerId);
  });

  /* The ledger is a single global chain shared with three other agents. A
     declaration landing between two of their records must not disturb it. */
  it("links onto whatever was already in the ledger", async () => {
    const taskId = `task_declare_chain_${Date.now()}`;
    await appendDecision({
      taskId,
      agent: "producer",
      agentCardId: "test",
      action: "before",
      input: {},
      output: {},
    });
    await declareWaste(declaration, ctx(taskId));

    const chain = await readChain(taskId);
    expect(chain).toHaveLength(2);
    expect(chain[1]?.action).toBe("declareWaste");
    expect(chain[1]?.prevHash).toBe(chain[0]?.hash);
    expect((await verifyLedger()).valid).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * THE POINT OF THE WHOLE PIECE: a declared lot has to behave like a lot all
 * the way down, not merely insert.
 *
 * This takes it one hop further than the producer - through a real matching
 * round, against a real unit, in the same database. The hops after that
 * (evidence -> verdict -> credit) run over HTTP through the gateway, which
 * has no declare route yet by design: nothing is wired in until the agent
 * works. scripts/e2e.mjs is where that end of it gets proven, once it is.
 * ------------------------------------------------------------------ */

describe.skipIf(!canRun)("a declared lot reaches the same destination as a detected one", () => {
  beforeEach(async () => {
    const d = db();
    await d.delete(schema.matches);
    await d.delete(schema.residueLots);
    await d.delete(schema.conversionUnits);
    await d.insert(schema.conversionUnits).values({
      unitId: "unit_declare_it",
      name: "Declared Waste Test Unit",
      lat: 30.905,
      lon: 75.861,
      capacityTonnesPerDay: 50,
      accepts: ["paddy_straw", "wheat_straw", "mixed"],
    });
  });

  it("is picked up by a matching round and leaves it matched", async () => {
    const { lot } = await declareWaste(declaration, ctx(`task_declare_match_${Date.now()}`));
    const result = await runMatching({ maxRadiusKm: 60 }, ctx(`task_match_declared_${Date.now()}`));

    const match = result.matches.find((m) => m.lotId === lot.lotId);
    expect(match, "the declared lot was not placed").toBeDefined();
    expect(match!.unitId).toBe("unit_declare_it");
    expect(match!.assignedTonnes).toBe(4.5);
    // A real road distance and a real transport debit, same as any other lot.
    expect(match!.distanceKm).toBeGreaterThan(0);
    expect(match!.transportKgCo2e).toBeGreaterThan(0);

    // And it left the round matched, so a second round cannot place it again.
    expect((await rowFor(lot.lotId))!.status).toBe("matched");
  });

  /* Matching must not care where a lot came from, and must not quietly lose
     the label on the way past either. */
  it("keeps its declared origin through the round", async () => {
    const { lot } = await declareWaste(declaration, ctx(`task_declare_keep_${Date.now()}`));
    await runMatching({ maxRadiusKm: 60 }, ctx(`task_match_keep_${Date.now()}`));

    expect((await rowFor(lot.lotId))!.origin).toBe("declared");
    expect((await rowFor(lot.lotId))!.sourceDetectionId).toBeNull();
    expect((await verifyLedger()).valid).toBe(true);
  });
});
