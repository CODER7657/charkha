import { describe, it, expect, beforeEach } from "vitest";
import { verifyChain } from "@charkha/core";
import { db } from "./index.ts";
import { decisionLog } from "./schema.ts";
import { appendDecision, readChain, verifyLedger } from "./ledger.ts";

/**
 * Integration tests - these need a real Postgres, because the guarantee being
 * tested (serialised appends) is enforced by Postgres, not by our code. CI
 * provides one; locally, `docker compose up -d db && pnpm db:push` does.
 *
 * Skipped rather than failed when there is no database, so a unit-test run on
 * a laptop without Docker stays green.
 */
const hasDb = Boolean(process.env["DATABASE_URL"]);

describe.skipIf(!hasDb)("decision ledger", () => {
  beforeEach(async () => {
    await db().delete(decisionLog);
  });

  const append = (taskId: string, action: string) =>
    appendDecision({
      taskId,
      agent: "verifier",
      agentCardId: "did:web:demo#verifier",
      action,
      input: { action, taskId },
      output: { ok: true },
      modelHash: "c".repeat(64),
      confidence: 0.9,
    });

  it("links sequentially from genesis", async () => {
    const a = await append("t1", "first");
    const b = await append("t1", "second");
    expect(a.seq).toBe(0);
    expect(b.seq).toBe(1);
    expect(b.prevHash).toBe(a.hash);
    expect((await verifyLedger()).valid).toBe(true);
  });

  /**
   * THE test. Without the advisory lock this fails - concurrent appends read
   * the same tail, claim the same seq, and the chain no longer verifies.
   */
  it("survives 50 concurrent appends from different tasks", async () => {
    const n = 50;
    await Promise.all(Array.from({ length: n }, (_, i) => append(`task_${i}`, `concurrent_${i}`)));

    const chain = await readChain();
    expect(chain).toHaveLength(n);

    // Every seq present exactly once, 0..n-1, no gaps and no duplicates.
    expect([...new Set(chain.map((r) => r.seq))].sort((x, y) => x - y)).toEqual(
      Array.from({ length: n }, (_, i) => i),
    );

    // And the hashes actually link up.
    expect(verifyChain(chain)).toEqual({ valid: true, length: n });
  });

  it("detects tampering after the fact", async () => {
    await append("t1", "first");
    const second = await append("t1", "second");

    // Simulate someone editing a stored record directly in the database.
    const chain = await readChain();
    const tampered = chain.map((r) => (r.seq === second.seq ? { ...r, confidence: 0.1 } : r));

    const verdict = verifyChain(tampered);
    expect(verdict.valid).toBe(false);
    if (!verdict.valid) expect(verdict.brokenAtSeq).toBe(second.seq);
  });

  it("reads back only one task's slice", async () => {
    await append("t1", "a");
    await append("t2", "b");
    await append("t1", "c");

    const slice = await readChain("t1");
    expect(slice.map((r) => r.action)).toEqual(["a", "c"]);
    // The slice is not independently verifiable - the full ledger is.
    expect((await verifyLedger()).valid).toBe(true);
  });
});
