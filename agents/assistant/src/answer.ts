import type { z } from "zod";
import type { AssistantAskInput, AssistantAnswerOutput } from "@charkha/core";
import type { SkillContext } from "@charkha/a2a";
import { PLANNERS, liveCall, makePlanner, type Resolved } from "./planner.ts";
import { resolve } from "./resolve.ts";

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
export type Resolve = (
  utterance: string,
  lang: z.infer<typeof AssistantAskInput>["lang"],
) => Resolved | Promise<Resolved>;

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
    const resolved = await deps.resolve(input.utterance, input.lang);

    /* A weak match is downgraded to `unknown` before the planner ever sees it,
       so a low-confidence `retire_credit` cannot reach a planning module at
       all. Refusing to understand is always safe; acting on a coin flip is
       not. */
    /* Written as "not confident enough" rather than "below the floor", and the
       difference is not style.
    
       `undefined < 0.5` is FALSE, so a confidence that never arrived used to
       pass the gate rather than fail it - an unresolved sentence would have
       been handed straight to a planner. NaN does the same. Both are exactly
       the states a broken or half-migrated resolver produces, and the old
       comparison failed open on every one of them.
    
       Hem found this while making the resolver async for ONNX: if `resolve()`
       returned a Promise, `resolved.confidence` is undefined and the gate
       silently disappears. That is fixed by the `await` above; this is the
       belt to its braces, because the next resolver will be written by
       somebody who has not read this comment. */
    const confident =
      typeof resolved.confidence === "number" && resolved.confidence >= MIN_CONFIDENCE;

    const gated: Resolved = confident
      ? resolved
      : { intent: "unknown", slots: resolved.slots ?? {}, confidence: resolved.confidence ?? 0 };

    /* Who is asking comes from the caller, never from the sentence.
    
       `retire_credit` needs a holder and `declare_waste` needs a declarer, and
       the resolver fills neither - correctly. A sentence is the wrong place to
       assert an identity: lift a holder out of prose and anyone can retire
       anyone's credit by typing the right name.
    
       Folded in here rather than in each planning module, so there is one
       answer to "where does the assistant think you are from" - and so the
       confirmation token, which is signed over these slots, commits to the
       identity the write will actually run as. */
    if (input.identity) {
      gated.slots = {
        ...gated.slots,
        holder: gated.slots.holder ?? input.identity,
        declaredBy: gated.slots.declaredBy ?? input.identity,
      };
    }

    ctx.progress(`intent ${gated.intent} (${gated.confidence.toFixed(2)})`);
    return deps.plan(gated, input.confirm, ctx.progress);
  };

/** The wiring the agent actually runs. */
export const answer = makeAnswer({
  resolve,
  plan: makePlanner({ planners: PLANNERS, call: liveCall, now: () => Date.now() }),
});
