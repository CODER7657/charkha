import type { DecisionRecord } from "./contracts.ts";
import { hashPayload, sha256Hex } from "./ids.ts";

export const GENESIS_HASH = "0".repeat(64);

export type DecisionInput = Omit<DecisionRecord, "seq" | "hash" | "prevHash" | "at"> & {
  at?: string;
};

/**
 * Link one decision onto the chain.
 *   hash = SHA256( prevHash + canonicalJson(body) )
 * Deterministic: same body + same prevHash always yields the same hash, which
 * is what makes tampering detectable.
 */
export const linkDecision = (
  prev: DecisionRecord | null,
  input: DecisionInput,
): DecisionRecord => {
  const prevHash = prev ? prev.hash : GENESIS_HASH;
  const seq = prev ? prev.seq + 1 : 0;
  const body = {
    seq,
    taskId: input.taskId,
    agent: input.agent,
    agentCardId: input.agentCardId,
    action: input.action,
    inputHash: input.inputHash,
    outputHash: input.outputHash,
    modelHash: input.modelHash,
    confidence: input.confidence,
    at: input.at ?? new Date().toISOString(),
    prevHash,
  };
  return { ...body, hash: sha256Hex(prevHash + hashPayload(body)) };
};

export type ChainVerdict =
  | { valid: true; length: number }
  | { valid: false; length: number; brokenAtSeq: number; reason: string };

/** Re-derive every hash. This is the function the audit console calls. */
export const verifyChain = (chain: readonly DecisionRecord[]): ChainVerdict => {
  let prevHash = GENESIS_HASH;
  for (let i = 0; i < chain.length; i++) {
    const rec = chain[i]!;
    if (rec.seq !== i)
      return { valid: false, length: chain.length, brokenAtSeq: rec.seq, reason: `expected seq ${i}, got ${rec.seq}` };
    if (rec.prevHash !== prevHash)
      return { valid: false, length: chain.length, brokenAtSeq: rec.seq, reason: "prevHash does not match previous record" };
    const { hash, ...body } = rec;
    const expected = sha256Hex(prevHash + hashPayload(body));
    if (hash !== expected)
      return { valid: false, length: chain.length, brokenAtSeq: rec.seq, reason: "record content does not match its hash" };
    prevHash = hash;
  }
  return { valid: true, length: chain.length };
};
