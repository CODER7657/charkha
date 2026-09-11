import { GENESIS_HASH, hashPayload, linkDecision, type CreditRecord, type DecisionRecord, type FieldEvidence, type Match } from "@charkha/core";
import type { RegistryStore } from "./store.ts";

/**
 * In-memory RegistryStore for tests.
 *
 * It keeps a REAL hash chain (via linkDecision) rather than a list of loose
 * rows, so a test that counts decisions or checks the custody pointer is
 * exercising the same behaviour the database path has. CI has no Postgres,
 * and the double-counting guard is too important to go untested there.
 */
export const memoryStore = (seed: { matches?: Match[]; evidence?: FieldEvidence[] } = {}) => {
  const matches = new Map((seed.matches ?? []).map((m) => [m.matchId, m]));
  const evidence = new Map((seed.evidence ?? []).map((e) => [e.evidenceId, e]));
  const credits: CreditRecord[] = [];
  const decisions: DecisionRecord[] = [];

  const store: RegistryStore = {
    findMatch: async (matchId) => matches.get(matchId) ?? null,
    findEvidence: async (evidenceId) => evidence.get(evidenceId) ?? null,
    findCreditByEvidenceId: async (evidenceId) => credits.find((c) => c.evidenceId === evidenceId) ?? null,
    findCreditById: async (creditId) => credits.find((c) => c.creditId === creditId) ?? null,
    listCredits: async () => [...credits],
    insertCredit: async (credit) => void credits.push({ ...credit }),
    markRetired: async (creditId) => {
      const credit = credits.find((c) => c.creditId === creditId);
      if (!credit) throw new Error(`no such credit: ${creditId}`);
      credit.status = "retired";
      return { ...credit };
    },
    headDecisionHash: async () => decisions.at(-1)?.hash ?? GENESIS_HASH,
    appendDecision: async (args) => {
      const rec = linkDecision(decisions.at(-1) ?? null, {
        taskId: args.taskId,
        agent: args.agent,
        agentCardId: args.agentCardId,
        action: args.action,
        inputHash: hashPayload(args.input),
        outputHash: hashPayload(args.output),
        modelHash: args.modelHash ?? null,
        confidence: args.confidence ?? null,
      });
      decisions.push(rec);
      return rec;
    },
  };

  return Object.assign(store, {
    /** Test-only views. */
    credits,
    decisions,
  });
};
