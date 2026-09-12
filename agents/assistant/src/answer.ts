import type { z } from "zod";
import type { AssistantAskInput, AssistantAnswerOutput } from "@charkha/core";
import type { SkillContext } from "@charkha/a2a";
import { PLANNERS, liveCall, makePlanner, type Resolved } from "./planner.ts";
import { resolveFallback } from "./resolve.fallback.ts";

/* ------------------------------------------------------------------ *
 * OWNER: core
 *
 * The skill entry point. Resolve, plan, call, report.
 *
 * `resolve` is injected rather than imported so that Hem's module (#62) drops
 * in without either of us editing the other's file, and so the planner can be
 * tested against a fake resolver with no network and no model.
 * ------------------------------------------------------------------ */

/** Hem's contract, #62. Utterance in, intent and slots out. Pure. */
export type Resolve = (utterance: string, lang: z.infer<typeof AssistantAskInput>["lang"]) => Resolved;

/**
 * Until resolve.ts lands, everything is `unknown` with zero confidence.
 *
 * Not a placeholder that pretends: this is exactly what the assistant must do
 * in production for a sentence it cannot place. Guessing a mutating intent
 * from an ambiguous sentence is the failure the whole design exists to
 * prevent, so there is no version of this that guesses - not even temporarily.
 */
export const unresolved: Resolve = () => ({ intent: "unknown", slots: {}, confidence: 0 });

/**
 * Below this, an intent is not acted on at all.
 *
 * Applied here rather than inside the resolver: how confident is confident
 * enough is a policy about consequences, not a property of the matching, and
 * it belongs next to the code that decides whether to call anything.
 */
export const MIN_CONFIDENCE = 0.5;

export type AnswerDeps = {
  resolve: Resolve;
  plan: ReturnType<typeof makePlanner>;
};

export const makeAnswer =
  (deps: AnswerDeps) =>
  async (
    input: z.infer<typeof AssistantAskInput>,
    ctx: SkillContext,
  ): Promise<AssistantAnswerOutput> => {
    ctx.progress(`resolving a ${input.lang} request`);
    const resolved = deps.resolve(input.utterance, input.lang);

    /* A weak match is downgraded to `unknown` before the planner ever sees it,
       so a low-confidence `retire_credit` cannot reach a planning module at
       all. Refusing to understand is always safe; acting on a coin flip is
       not. */
    const gated: Resolved =
      resolved.confidence < MIN_CONFIDENCE
        ? { intent: "unknown", slots: resolved.slots, confidence: resolved.confidence }
        : resolved;

    ctx.progress(`intent ${gated.intent} (${gated.confidence.toFixed(2)})`);
    return deps.plan(gated, input.confirm, ctx.progress);
  };

/**
 * The wiring the agent actually runs.
 *
 * `resolveFallback` is a stand-in: English only, patterns only. When Hem's
 * four-language resolver lands (#62) this one line changes and
 * resolve.fallback.ts is deleted.
 */
export const answer = makeAnswer({
  resolve: resolveFallback,
  plan: makePlanner({ planners: PLANNERS, call: liveCall, now: () => Date.now() }),
});
