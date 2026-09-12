import { AGENTS, callAgent, AgentRequestError } from "@charkha/a2a";
import type { AgentHop, AssistantAnswerOutput, AssistantIntent, AssistantSlots } from "@charkha/core";
import { checkConfirmation, mintConfirmation } from "./confirm.ts";
import { msg, type Plan, type PlannedCall, type Planner } from "./plan/types.ts";
import { planImpactSummary, planLotStatus } from "./plan/lots.ts";
import { planRunMatching } from "./plan/matching.ts";

/* ------------------------------------------------------------------ *
 * OWNER: core
 *
 * Dispatch a resolved intent, call the agents it needs, report the hops.
 *
 * The planning modules are pure - slots in, a plan out. Everything with a
 * consequence happens here: the A2A calls, the confirmation check, and the
 * decision about whether a write is allowed to proceed. One place, so there is
 * one answer to "what does it take for a sentence to change state".
 *
 * The hops are returned rather than logged because they are the evidence. An
 * answer that took four agents to produce should be able to show that it did;
 * a mesh nobody can see is indistinguishable from a single service with good
 * copy.
 * ------------------------------------------------------------------ */

/**
 * Which planning module owns which intent.
 *
 * `declare_waste` and the two credit intents land as owners finish them. An
 * intent with no planner answers "not built yet" rather than throwing - the
 * assistant must degrade into saying so, never into a 500.
 */
export type PlannerTable = Partial<Record<AssistantIntent, Planner>>;

export const PLANNERS: PlannerTable = {
  lot_status: planLotStatus,
  impact_summary: planImpactSummary,
  run_matching: planRunMatching,
  // declare_waste  -> plan/declare.ts   (Harsh, #63)
  // credit_status  -> plan/credits.ts   (Ayush, #64)
  // retire_credit  -> plan/credits.ts   (Ayush, #64)
};

export type PlannerDeps = {
  planners: PlannerTable;
  /* Not generic. The planner hands every output straight to a planning
     module's renderer, which knows its own shape; a generic here buys nothing
     and makes the dependency impossible to fake with a concrete function. */
  call: (c: PlannedCall) => Promise<{ taskId: string; output: unknown }>;
  now: () => number;
};

/** Real A2A. Same bearer token, same task lifecycle, same refusals as any agent-to-agent call. */
export const liveCall = async (c: PlannedCall): Promise<{ taskId: string; output: unknown }> =>
  callAgent<unknown>(AGENTS[c.agent](), c.skill, c.input, { callerName: "assistant" });

const hop = (c: PlannedCall, taskId: string | null, ms: number, ok: boolean): AgentHop => ({
  agent: c.agent,
  skill: c.skill,
  taskId,
  ms,
  ok,
});

/**
 * What the user reads when an agent refuses, and what we keep for ourselves.
 *
 * The reply may NOT carry the agent's own message. Those are English
 * sentences written for a developer - "registry.retireCredit: refusing to
 * retire crd_9dd23c3c...: retiredBy does not match the credit's holder" - and
 * `t()` cannot reach inside a parameter, so on a Punjabi screen the frame
 * translates and the sentence does not. That is the same failure the verifier
 * had with `reasons`, and the reason every message here is a key.
 *
 * The detail is not thrown away. It goes in `data`, where the console and
 * whoever is debugging can read it, and where nobody is trying to read it as
 * a sentence.
 */
/* Intents whose refusal deserves its own sentence, because "the registry
   would not do that" is true and useless. Chosen by intent, never by reading
   the agent's message - matching on prose is how a reworded refusal silently
   changes what a user is told. */
const REFUSAL_KEY: Partial<Record<AssistantIntent, string>> = {
  retire_credit: "assistant.refused.retire_credit",
};

const refusal = (c: PlannedCall, intent: AssistantIntent, err: unknown) => ({
  reply:
    err instanceof AgentRequestError
      ? msg(REFUSAL_KEY[intent] ?? "assistant.refused", { agent: c.agent, skill: c.skill, intent })
      : msg("assistant.unavailable", { agent: c.agent }),
  data:
    err instanceof AgentRequestError
      ? { refused: { agent: c.agent, skill: c.skill, detail: err.message } }
      : null,
});

/** Everything an answer needs beyond what the planner produced. */
export type Resolved = { intent: AssistantIntent; slots: AssistantSlots; confidence: number };

export const makePlanner =
  (deps: PlannerDeps) =>
  async (
    resolved: Resolved,
    confirm: string | undefined,
    progress: (note: string) => void,
  ): Promise<AssistantAnswerOutput> => {
    const { intent, slots, confidence } = resolved;
    const base = { intent, slots, confidence, confirmation: null, performed: false, hops: [], data: null };

    const planner = deps.planners[intent];
    if (intent === "unknown" || !planner) {
      return { ...base, reply: msg("assistant.not_understood") };
    }

    const plan: Plan = planner(slots);

    if (plan.status === "need") return { ...base, reply: plan.reply };

    if (plan.status === "read") {
      const hops: AgentHop[] = [];
      const outputs: unknown[] = [];
      for (const c of plan.calls) {
        progress(`asking ${c.agent}.${c.skill}`);
        const started = deps.now();
        try {
          const { taskId, output } = await deps.call(c);
          hops.push(hop(c, taskId, deps.now() - started, true));
          outputs.push(output);
        } catch (err) {
          hops.push(hop(c, null, deps.now() - started, false));
          /* A refusal is the caller's problem and is worth repeating; anything
             else is ours and should not be dressed up as an answer. Either way
             the hop is recorded as failed, so the UI shows the agent that did
             not answer rather than silently showing three of four. */
          return { ...base, hops, ...refusal(c, intent, err) };
        }
      }
      return { ...base, hops, reply: plan.reply(outputs), data: outputs.length === 1 ? outputs[0] : outputs };
    }

    /* A write. Nothing has happened yet and nothing will until a token that
       was minted for THIS intent and THESE slots comes back. */
    if (!confirm) {
      return {
        ...base,
        reply: plan.summary,
        confirmation: { token: mintConfirmation(intent, slots, deps.now()), summary: plan.summary },
      };
    }

    const check = checkConfirmation(confirm, intent, slots, deps.now());
    if (!check.ok) {
      /* Re-propose rather than dead-end. A stale tab is the common case and
         making someone retype the sentence to recover from our own five-minute
         window is a punishment for reading carefully. A mismatch does NOT get
         a fresh token: that one means the request changed after the proposal,
         which is the exact thing the binding exists to stop. */
      if (check.reason === "mismatch") {
        return { ...base, reply: msg("assistant.confirm.mismatch") };
      }
      return {
        ...base,
        reply: msg(`assistant.confirm.${check.reason}`),
        confirmation: { token: mintConfirmation(intent, slots, deps.now()), summary: plan.summary },
      };
    }

    progress(`confirmed - calling ${plan.call.agent}.${plan.call.skill}`);
    const started = deps.now();
    try {
      const { taskId, output } = await deps.call(plan.call);
      return {
        ...base,
        performed: true,
        hops: [hop(plan.call, taskId, deps.now() - started, true)],
        reply: plan.done(output),
        data: output,
      };
    } catch (err) {
      return {
        ...base,
        hops: [hop(plan.call, null, deps.now() - started, false)],
        ...refusal(plan.call, intent, err),
      };
    }
  };
