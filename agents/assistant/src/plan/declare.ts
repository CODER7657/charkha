import type { AssistantMessage, AssistantSlots, DeclareWasteInput, GeoPoint } from "@charkha/core";

/* ------------------------------------------------------------------ *
 * OWNER: Harsh
 *
 * Planning a declaration. Slots in; either "what is still missing" or "here
 * is the call to make" out.
 *
 * PURE. It does not call the producer, mint a confirmation token, read a
 * clock or touch a database - the planner owns all of that. That boundary is
 * what lets three people work in this directory at once, and it is what makes
 * this file testable without a running mesh.
 *
 * Every string it returns is a KEY, never a sentence. The verifier returns
 * English prose in `reasons` and that prose stays English on a fully Punjabi
 * screen, because t() cannot reach inside a finished sentence. We are not
 * repeating that here.
 * ------------------------------------------------------------------ */

/**
 * What a declaration needs before it can be made, in the order we ask for it.
 *
 * This is also the order `missing` comes back in - the guard inside
 * planDeclare walks the same sequence, and a test pins the two together.
 *
 * `place` is asked for third, after what and how much, because those two are
 * usually already in the sentence someone typed. `declaredBy` is asked LAST
 * and usually not at all: it is the one field the planner can normally fill
 * from whoever is signed in, and opening with "who are you?" interrogates
 * somebody about the thing we are most likely to already know.
 */
export const DECLARE_SLOTS = ["feedstock", "tonnes", "place", "declaredBy"] as const;
export type DeclareSlot = (typeof DECLARE_SLOTS)[number];

/** One key per missing slot. The client owns the wording, in four languages. */
export const NEED_KEY: Record<DeclareSlot, string> = {
  feedstock: "assistant.declare.need_feedstock",
  tonnes: "assistant.declare.need_tonnes",
  place: "assistant.declare.need_place",
  declaredBy: "assistant.declare.need_declared_by",
};

/** What is about to happen, for the confirmation the planner puts in front of the user. */
export const SUMMARY_KEY = "assistant.declare.summary";

/**
 * What the planner knows that an utterance cannot say.
 *
 * `at` is the one that matters. `AssistantSlots` carries a district NAME and
 * nothing else, while `DeclareWasteInput` requires a point - so a place has
 * to arrive from outside the sentence: the declarer's device, or a map pin.
 *
 * This module will NOT turn a district name into coordinates, and that is a
 * deliberate refusal rather than a missing feature. A lot's point drives the
 * road distance to a conversion unit and therefore the transport debit on the
 * credit. Dropping every declaration in Ludhiana onto one centroid would
 * produce a carbon number carrying a precision nobody measured - in a system
 * whose entire argument is that its numbers are checkable. Better to ask
 * where, than to answer it ourselves and be believed.
 */
export type DeclareContext = {
  /** Where the waste is. From the device or a map pin; never inferred here. */
  at?: GeoPoint;
  /** Who is declaring, when the session knows and the sentence did not say. */
  declaredBy?: string;
  /** The declarer's own words, kept verbatim for the ledger. */
  note?: string;
  /** When it is ready for collection. Omitted means "now", decided at the agent. */
  availableFrom?: string;
};

export type DeclarePlan =
  | {
      ready: false;
      /** Everything still outstanding, so a form can show it all at once. */
      missing: DeclareSlot[];
      /** The single thing to ask for next, if you are asking one at a time. */
      ask: AssistantMessage;
    }
  | { ready: true; input: DeclareWasteInput; summary: AssistantMessage };

/** Present means non-empty. A resolver that finds nothing hands back "", and
    an empty declarer is exactly the anonymous claim the contract refuses. */
const text = (v: string | undefined): string | null => {
  const trimmed = (v ?? "").trim();
  return trimmed === "" ? null : trimmed;
};

export const planDeclare = (slots: AssistantSlots, ctx: DeclareContext = {}): DeclarePlan => {
  /* The session wins over the sentence, and that is a security decision, not
     a preference. `producerId` on the resulting lot becomes the credential's
     `holder`, and only the holder can retire that credit - so if a typed
     "Ward 7 declares..." could override who is signed in, anyone could mint
     credits into somebody else's name by saying so. */
  const declaredBy = text(ctx.declaredBy ?? slots.declaredBy);
  const district = text(slots.district);
  /* Finite AND positive. "0 tonnes" and "-1 tonnes" are not small
     declarations, they are a resolver that did not really find a number, and
     asking again reads better than a round trip to the producer for a 400.
     The 10,000 t ceiling is the opposite case - a policy, stated once in the
     contract - so it is deliberately not repeated here. */
  const tonnes =
    typeof slots.tonnes === "number" && Number.isFinite(slots.tonnes) && slots.tonnes > 0
      ? slots.tonnes
      : null;

  const { feedstock } = slots;
  const at = ctx.at;

  /* One expression decides what is missing AND narrows what is left, so the
     two can never disagree. Written as a guard rather than a filter-then-
     assert for exactly that reason: `missing.length === 0` and "every value
     is present" were two separate claims, and the compiler could only check
     one of them. Trusting the first to imply the second is how a planner ends
     up shipping `undefined` as a feedstock. */
  if (feedstock === undefined || tonnes === null || at === undefined || declaredBy === null) {
    const missing: DeclareSlot[] = [
      ...(feedstock === undefined ? (["feedstock"] as const) : []),
      ...(tonnes === null ? (["tonnes"] as const) : []),
      ...(at === undefined ? (["place"] as const) : []),
      ...(declaredBy === null ? (["declaredBy"] as const) : []),
    ];

    /* Ask for one thing. `missing` carries the rest for a caller that would
       rather show a form, but a conversation that answers a sentence with
       four questions is not a conversation. What we already know goes in the
       params so the question can be specific - "how many tonnes of paddy
       straw?" reads like someone listening. */
    const params: AssistantMessage["params"] = {
      ...(feedstock ? { feedstock } : {}),
      ...(tonnes !== null ? { tonnes } : {}),
      ...(district ? { district } : {}),
    };
    return { ready: false, missing, ask: { key: NEED_KEY[missing[0]!], params } };
  }

  /* Built, not validated. The producer's A2A boundary parses DeclareWasteInput
     on the way in and refuses with a 400 - re-checking it here would be the
     same guard written twice, and two copies of a bound drift. So this
     function cannot throw, whatever a resolver hands it: the worst case is a
     payload the producer refuses with a message the declarer can act on.
  
     The contract's bounds are deliberately NOT mirrored here for the same
     reason. `tonnes` is gated above only for finite-and-positive, which is
     "the resolver did not really find a number"; the 10,000 t ceiling is a
     policy, it lives in the contract, and it belongs in exactly one place.
  
     The note is passed through untouched. It is the declarer's own words, it
     goes into the ledger hash verbatim, and a planner that quietly trimmed it
     would be editing evidence. */
  const input: DeclareWasteInput = {
    declaredBy,
    feedstock,
    tonnes,
    at,
    district,
    ...(ctx.availableFrom ? { availableFrom: ctx.availableFrom } : {}),
    ...(ctx.note !== undefined && ctx.note.trim() !== "" ? { note: ctx.note } : {}),
  };

  return {
    ready: true,
    input,
    summary: {
      key: SUMMARY_KEY,
      params: {
        declaredBy: input.declaredBy,
        feedstock: input.feedstock,
        tonnes: input.tonnes,
        ...(input.district ? { district: input.district } : {}),
      },
    },
  };
};
