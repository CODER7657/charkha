import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FieldEvidence } from "@charkha/core";
import { REPO_ROOT } from "./modelFiles.ts";
import { openModel, type LoadedModel } from "./onnx.ts";
import { CANARY_PREFIX, CLASSES, canaryTensor } from "./protocol.ts";
import { MalformedEvidenceError, makeVerifyEvidence } from "./skills/verifyEvidence.ts";

/**
 * The verifier end to end against a real Postgres, the real ONNX session and
 * the real hash-chained ledger. Only the A2A transport is bypassed.
 *
 * Runs in its own Postgres schema, cloned from `public`, so it never touches
 * the tables packages/db/src/ledger.test.ts truncates while running in
 * parallel. Skips without a local DATABASE_URL, like the ledger tests.
 */
const baseUrl = process.env["DATABASE_URL"];
const isLocal = (u: string) => {
  try {
    return ["localhost", "127.0.0.1", "::1", "db"].includes(new URL(u).hostname);
  } catch {
    return false;
  }
};
const canRun = Boolean(baseUrl) && (isLocal(baseUrl!) || process.env["ALLOW_DESTRUCTIVE_TESTS"] === "1");

const SCHEMA = "charkha_verifier_it";
const TABLES = ["decision_log", "evidence", "verifications", "matches", "residue_lots"];

describe.skipIf(!canRun)("verifier against a real database and model", () => {
  let model: LoadedModel;
  // Imported only after DATABASE_URL points at the isolated schema.
  let dbmod: typeof import("@charkha/db");
  let store: typeof import("./store.ts");
  let ledger: typeof import("@charkha/db/ledger");
  let verify: ReturnType<typeof makeVerifyEvidence>;

  const q = async (text: string) => (await dbmod.db().execute(dbmod.sql.raw(text))).rows as Array<Record<string, unknown>>;
  const count = async (table: string) => Number((await q(`SELECT count(*)::int AS n FROM ${SCHEMA}.${table}`))[0]!["n"]);

  beforeAll(async () => {
    // Every connection in the shared pool resolves unqualified tables in our schema.
    const url = new URL(baseUrl!);
    url.searchParams.set("options", `-c search_path=${SCHEMA}`);
    process.env["DATABASE_URL"] = url.toString();
    dbmod = await import("@charkha/db");
    store = await import("./store.ts");
    ledger = await import("@charkha/db/ledger");

    await q(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await q(`CREATE SCHEMA ${SCHEMA}`);
    for (const t of TABLES) await q(`CREATE TABLE ${SCHEMA}.${t} (LIKE public.${t} INCLUDING ALL)`);
    await q(
      `INSERT INTO ${SCHEMA}.residue_lots (lot_id, producer_id, lat, lon, district, feedstock, tonnes, available_from, status)
       VALUES ('lot_it', 'prod_it', 30.95, 75.8, 'Ludhiana', 'paddy_straw', 12, now(), 'matched')`,
    );
    await q(
      `INSERT INTO ${SCHEMA}.matches (match_id, lot_id, unit_id, distance_km, transport_kg_co2e, assigned_tonnes, decided_at, rationale)
       VALUES ('match_it', 'lot_it', 'unit_ldh', 8.4, 10.8, 10, now(), 'integration fixture')`,
    );

    model = await openModel(path.join(REPO_ROOT, "ml/models/baseline-char-quality.onnx"));
    verify = makeVerifyEvidence({
      model: () => model,
      agentCardId: "http://localhost:4003/.well-known/agent-card.json",
      findMatch: store.findMatch,
      findPrior: store.findPrior,
      findByImageHash: store.findByImageHash,
      claimEvidence: store.claimEvidence,
      appendDecision: ledger.appendDecision,
      saveVerification: store.saveVerification,
      now: () => new Date(),
    });
  });

  afterAll(async () => {
    if (!dbmod) return;
    await q(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await dbmod.db().$client.end();
  });

  let n = 0;
  const ctx = () => ({ taskId: `task_it_${++n}`, contextId: "ctx", progress: () => {} });

  /**
   * Evidence as the browser would build it: canary scored by the same model.
   *
   * Each call is a DIFFERENT photograph. It used to derive the hash from the
   * task counter while randomising the evidence id, so two calls could hand
   * back the same photo under two ids - which is now the one thing the
   * verifier refuses outright. Tests that mean "the same submission, twice"
   * say so by re-sending one fixture object, not by calling this again.
   */
  let photos = 0;
  const evidence = async (over: Partial<FieldEvidence> = {}): Promise<FieldEvidence> => {
    const imageHash = (over.imageHash ?? `${++photos}`.padStart(64, "e")).toLowerCase();
    const canary = await model.run(canaryTensor(imageHash));
    const clientScores: Record<string, number> = {};
    for (const c of CLASSES) clientScores[`${CANARY_PREFIX}${c}`] = canary[c];
    Object.assign(clientScores, { good_char: 0.92, poor_char: 0.06, not_char: 0.02 });
    return {
      evidenceId: `ev_it_${photos}_${Math.random().toString(36).slice(2, 8)}`,
      matchId: "match_it",
      at: { lat: 30.9, lon: 75.85 },
      capturedAt: new Date(Date.now() - 60_000).toISOString(),
      imageHash,
      modelHash: model.hash,
      modelVersion: model.version,
      clientScores,
      batch: { pyrolysisPeakTempC: 560, residenceTimeMin: 95, feedstock: "paddy_straw", outputTonnes: 2.8, hcOrgRatio: 0.42 },
      ...over,
    };
  };

  it("accepts real evidence, attests the canary and writes one chained decision", async () => {
    const before = await count("decision_log");
    const c = ctx();
    const e = await evidence();
    const out = await verify(e, c);

    expect(out.verdict).toBe("accepted");
    expect(out.reasons.join(" ")).toMatch(/canary attested/);
    expect(out.methodologyChecks.map((m) => m.check)).toContain("feedstock_matches_lot");

    const chain = await ledger.readChain(c.taskId);
    expect(chain).toHaveLength(1);
    expect(chain[0]).toMatchObject({ agent: "verifier", action: "verifyEvidence", modelHash: model.hash });
    expect(chain[0]!.confidence).toBeCloseTo(0.92);
    expect(await count("decision_log")).toBe(before + 1);
    expect((await ledger.verifyLedger()).valid).toBe(true);

    // persisted where the gateway's trace builder looks for it
    const prior = await store.findPrior(e.evidenceId);
    expect(prior?.verification).toEqual(out);
    const row = await q(`SELECT task_id FROM ${SCHEMA}.verifications WHERE evidence_id = '${e.evidenceId}'`);
    expect(row[0]!["task_id"]).toBe(c.taskId);
  });

  it("an offline retry of the same evidence replays the verdict and never double-writes the ledger", async () => {
    const e = await evidence();
    const first = await verify(e, ctx());
    const ledgerAfterFirst = await count("decision_log");

    const again = await verify(structuredClone(e), ctx());
    expect(again).toEqual(first);
    expect(await count("decision_log")).toBe(ledgerAfterFirst);
    expect((await ledger.verifyLedger()).valid).toBe(true);
  });

  it("concurrent duplicates of one submission produce exactly one decision", async () => {
    const e = await evidence();
    const before = await count("decision_log");
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => verify(structuredClone(e), ctx())));

    // every duplicate waits for the first and gets the same recorded verdict
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const outs = results.map((r) => (r as PromiseFulfilledResult<unknown>).value);
    for (const o of outs) expect(o).toEqual(outs[0]);
    expect(await count("decision_log")).toBe(before + 1);
    expect(await count("evidence")).toBeGreaterThan(0);
  });

  it("refuses to reuse an evidenceId for different content", async () => {
    const e = await evidence();
    await verify(e, ctx());
    const before = await count("decision_log");
    await expect(verify({ ...e, batch: { ...e.batch, outputTonnes: 3.9 } }, ctx())).rejects.toThrow(/different content/);
    expect(await count("decision_log")).toBe(before);
  });

  it("malformed evidence is refused before the session and leaves no trace in any table", async () => {
    const spied = { ...model, run: async () => expect.unreachable("ONNX session must not run") };
    const guarded = makeVerifyEvidence({
      model: () => spied,
      agentCardId: "it",
      findMatch: store.findMatch,
      findPrior: store.findPrior,
      findByImageHash: store.findByImageHash,
      claimEvidence: store.claimEvidence,
      appendDecision: ledger.appendDecision,
      saveVerification: store.saveVerification,
      now: () => new Date(),
    });
    const e = await evidence();
    const before = { log: await count("decision_log"), ev: await count("evidence") };
    await expect(guarded({ ...e, batch: { ...e.batch, pyrolysisPeakTempC: 25_000 } }, ctx())).rejects.toBeInstanceOf(
      MalformedEvidenceError,
    );
    expect(await count("decision_log")).toBe(before.log);
    expect(await count("evidence")).toBe(before.ev);
  });

  it("tampered client canary scores are recorded as needs_review", async () => {
    const e = await evidence();
    const out = await verify(
      { ...e, clientScores: { ...e.clientScores, "canary:good_char": 0.5, "canary:not_char": e.clientScores["canary:not_char"]! - 0.5 + e.clientScores["canary:good_char"]! } },
      ctx(),
    );
    expect(out.verdict).toBe("needs_review");
    expect((await store.findPrior(e.evidenceId))?.verification?.verdict).toBe("needs_review");
  });

  /* The whole point, end to end against the real database: one photograph of
     one pile, submitted under a second id. Every other guard passes it - new
     id, valid match, and a canary that attests perfectly, because the canary
     is seeded from this very hash. Only the unique index says no. */
  it("refuses the same photograph submitted under a second evidence id", async () => {
    const first = await evidence();
    await verify(first, ctx());
    const before = { log: await count("decision_log"), ev: await count("evidence") };

    const second = await evidence({ imageHash: first.imageHash });
    expect(second.evidenceId).not.toBe(first.evidenceId);

    await expect(verify(second, ctx())).rejects.toThrow(/refusing to credit the same image twice/);
    expect(await count("decision_log")).toBe(before.log);
    expect(await count("evidence")).toBe(before.ev);
    expect(await store.findPrior(second.evidenceId)).toBeNull();
  });

  it("evidence against an unknown match is rejected", async () => {
    const out = await verify(await evidence({ matchId: "match_nope" }), ctx());
    expect(out.verdict).toBe("rejected");
    expect(out.methodologyChecks.find((m) => m.check === "output_vs_matched_lot")?.passed).toBe(false);
  });
});
