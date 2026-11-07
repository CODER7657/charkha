import type { AssistantMessage, AssistantSlots } from "@charkha/core";

/* ------------------------------------------------------------------ *
 * OWNER: core
 *
 * The shape every planning module returns. Read this before writing one.
 *
 * A planning module is a PURE FUNCTION: slots in, a plan out. It does not
 * call an agent, touch a database, or know whether the user has confirmed
 * anything. The planner (../planner.ts) does all of that.
 *
 * That boundary is what lets three people work in this directory at once, and
 * what makes every one of these modules testable with no network and no
 * fixtures beyond a slots object.
 * ------------------------------------------------------------------ */

/** Which agent, which skill, what input. The planner turns this into a real A2A call. */
export type PlannedCall = {
  agent: "producer" | "matchmaker" | "verifier" | "registry";
  skill: string;
  input: unknown;
};

export type Plan =
  /** Not enough to act on. Say what is missing; nothing is called. */
  | { status: "need"; reply: AssistantMessage }
  /** Safe to run immediately: reads only. `reply` renders whatever came back. */
  | { status: "read"; calls: PlannedCall[]; reply: (outputs: unknown[]) => AssistantMessage }
  /**
   * Would change state. The planner proposes this and waits for a confirmation
   * token bound to the exact intent and slots; only then does it call.
   * `summary` is what the user is agreeing to, so it must name the specifics -
   * not "retire a credit" but which credit, how much, and as whom.
   */
  | {
      status: "write";
      summary: AssistantMessage;
      call: PlannedCall;
      done: (output: unknown) => AssistantMessage;
    };

/** A planning module. */
export type Planner = (slots: AssistantSlots) => Plan;

/** Small helper so modules do not repeat the params default. */
export const msg = (key: string, params: AssistantMessage["params"] = {}): AssistantMessage => ({
  key,
  params,
});
