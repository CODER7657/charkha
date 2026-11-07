import { describe, it, expect } from "vitest";
import { linkDecision, verifyChain, GENESIS_HASH } from "./hashchain.ts";
import type { DecisionRecord } from "./contracts.ts";

const rec = (taskId: string, action: string, prev: DecisionRecord | null) =>
  linkDecision(prev, {
    taskId,
    agent: "verifier",
    agentCardId: "did:web:demo#verifier",
    action,
    inputHash: "a".repeat(64),
    outputHash: "b".repeat(64),
    modelHash: "c".repeat(64),
    confidence: 0.91,
    at: "2026-09-11T10:00:00.000Z",
  });

describe("hash chain", () => {
  it("starts from genesis and increments seq", () => {
    const a = rec("t1", "verify", null);
    const b = rec("t1", "issue", a);
    expect(a.prevHash).toBe(GENESIS_HASH);
    expect(a.seq).toBe(0);
    expect(b.seq).toBe(1);
    expect(b.prevHash).toBe(a.hash);
  });

  it("is deterministic for identical input", () => {
    expect(rec("t1", "verify", null).hash).toBe(rec("t1", "verify", null).hash);
  });

  it("accepts an untampered chain", () => {
    const a = rec("t1", "verify", null);
    const chain = [a, rec("t1", "issue", a)];
    expect(verifyChain(chain)).toEqual({ valid: true, length: 2 });
  });

  it("detects a tampered record - this is the demo moment", () => {
    const a = rec("t1", "verify", null);
    const chain = [a, rec("t1", "issue", a)];
    const tampered = [{ ...chain[0]!, confidence: 0.99 }, chain[1]!];
    const verdict = verifyChain(tampered);
    expect(verdict.valid).toBe(false);
    if (!verdict.valid) expect(verdict.brokenAtSeq).toBe(0);
  });

  it("detects a removed record", () => {
    const a = rec("t1", "verify", null);
    const b = rec("t1", "issue", a);
    const verdict = verifyChain([a, rec("t1", "retire", b)]);
    expect(verdict.valid).toBe(false);
  });
});
