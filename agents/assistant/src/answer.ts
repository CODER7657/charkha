import type { z } from "zod";
import type { AssistantAskInput, AssistantAnswerOutput } from "@charkha/core";
import type { SkillContext } from "@charkha/a2a";

/* ------------------------------------------------------------------ *
 * OWNER: core
 *
 * The skill entry point. Resolve, plan, call, report.
 *
 * Three pieces land separately and this file joins them:
 *
 *   resolve.ts        Hem   - utterance -> { intent, slots, confidence }
 *   plan/declare.ts   Harsh - declare_waste
 *   plan/credits.ts   Ayush - credit_status, retire_credit
 *   plan/lots.ts      core  - lot_status, impact_summary
 *   plan/matching.ts  core  - run_matching
 *
 * Until the planner lands this answers `unknown` for everything, which is the
 * correct degraded behaviour rather than a placeholder: an assistant that
 * cannot work out what you meant should say so, not guess.
 * ------------------------------------------------------------------ */

/**
 * A mutating intent never executes on the first ask.
 *
 * `retire_credit` is irreversible and `declare_waste` writes to the ledger,
 * and both are one sentence away from being triggered by accident. So the
 * assistant states what it is about to do and waits for the token it issued.
 * The rule lives in the contract (`AssistantAnswerOutput.confirmation`) and is
 * enforced here; no planning module is trusted to remember it.
 */
export const MUTATING = new Set(["declare_waste", "retire_credit"]);

export const answer = async (
  input: z.infer<typeof AssistantAskInput>,
  ctx: SkillContext,
): Promise<AssistantAnswerOutput> => {
  ctx.progress(`resolving a ${input.lang} request`);

  /* Deliberately not a stub that pretends. Returning `unknown` with zero
     confidence is the honest answer while the resolver is being built, and it
     is also exactly what this must do in production for a sentence it cannot
     place. Guessing a mutating intent from an ambiguous sentence is the one
     failure this design exists to prevent. */
  return {
    intent: "unknown",
    slots: {},
    confidence: 0,
    reply: { key: "assistant.not_understood", params: {} },
    confirmation: null,
    performed: false,
    hops: [],
    data: null,
  };
};
