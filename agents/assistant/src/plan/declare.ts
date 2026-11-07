import type { AssistantMessage, DeclareWasteInput, ResidueLot } from "@charkha/core";
import { msg, type Plan, type Planner } from "./types.ts";
/* Reaching into the producer for one lookup, and flagged rather than hidden.
   The district centroid table lives in firms.ts because that is where it is
   used the other way round - point to district name - and copying 33
   centroids here would be the same data in two places, where the first
   correction to one silently disagrees with the other. It belongs in
   @charkha/core; that is core's call, and one import line the day it moves. */
import { districtCentroid } from "../../../producer/src/firms.ts";

/* ------------------------------------------------------------------ *
 * OWNER: Harsh
 *
 * "We have 4 tonnes of market waste in Ludhiana."
 *
 * PURE. Slots in, a plan out. It does not call the producer, mint the
 * confirmation token, read a clock or touch a database - ../planner.ts owns
 * all of that.
 *
 * This is a `write`, and not a marginal one. A declaration creates a lot and
 * appends a record to an append-only ledger that rule 5 says can never be
 * removed. It is also a claim somebody expects to be PAID for, which makes an
 * accidental one worse than an accidental read: it enters the supply side of
 * a carbon system under a name.
 *
 * Every string here is a KEY. The verifier returns English prose in `reasons`
 * and that prose stays English on a fully Punjabi screen, because t() cannot
 * reach inside a finished sentence. We are not repeating that.
 * ------------------------------------------------------------------ */

/**
 * What a declaration needs, in the order it is asked for.
 *
 * What and how much come first, because they are usually already in the
 * sentence. `declaredBy` is asked LAST and usually not at all: the planner can
 * normally fill it from whoever is signed in, and opening with "who are you?"
 * interrogates somebody about the thing we are most likely to already know.
 */
export const DECLARE_SLOTS = ["feedstock", "tonnes", "place", "declaredBy"] as const;
export type DeclareSlot = (typeof DECLARE_SLOTS)[number];

export const NEED_KEY: Record<DeclareSlot, string> = {
  feedstock: "assistant.declare.need_feedstock",
  tonnes: "assistant.declare.need_tonnes",
  place: "assistant.declare.need_place",
  declaredBy: "assistant.declare.need_declared_by",
};

/** A district we do not cover is a different answer from no district at all. */
export const UNKNOWN_DISTRICT_KEY = "assistant.declare.unknown_district";
export const CONFIRM_KEY = "assistant.declare.confirm";
export const DONE_KEY = "assistant.declare.done";

/** Present means non-empty. A resolver that found nothing hands back "". */
const text = (v: string | undefined): string | null => {
  const trimmed = (v ?? "").trim();
  return trimmed === "" ? null : trimmed;
};

export const planDeclare: Planner = (slots): Plan => {
  const declaredBy = text(slots.declaredBy);
  const district = text(slots.district);
  /* Finite AND positive. "0 tonnes" is not a small declaration, it is a
     resolver that did not really find a number, and asking again reads better
     than a round trip to the producer for a 400. The 10,000 t ceiling is the
     opposite case - a policy, stated once in the contract - so it is
     deliberately not repeated here. */
  const tonnes =
    typeof slots.tonnes === "number" && Number.isFinite(slots.tonnes) && slots.tonnes > 0
      ? slots.tonnes
      : null;
  const { feedstock } = slots;

  /** What we already know, so a question can be specific rather than generic. */
  const known: AssistantMessage["params"] = {
    ...(feedstock ? { feedstock } : {}),
    ...(tonnes !== null ? { tonnes } : {}),
    ...(district ? { district } : {}),
  };

  if (feedstock === undefined) return { status: "need", reply: msg(NEED_KEY.feedstock, known) };
  if (tonnes === null) return { status: "need", reply: msg(NEED_KEY.tonnes, known) };
  if (district === null) return { status: "need", reply: msg(NEED_KEY.place, known) };

  /* A district name we do not have a centre for is not a missing answer - the
     person answered, and we cannot place it. Saying "which district?" again
     would be a loop they cannot get out of, so this says the district is
     outside the belt we cover instead. */
  const at = districtCentroid(district);
  if (at === null) return { status: "need", reply: msg(UNKNOWN_DISTRICT_KEY, known) };

  if (declaredBy === null) return { status: "need", reply: msg(NEED_KEY.declaredBy, known) };

  /* The district CENTRE, and the confirmation says so.

     A sentence gives a district and nothing finer, `AssistantSlots` cannot
     carry a point, and `DeclareWasteInput` requires one - so the centre is
     the only honest reading of "in Ludhiana". It can be 30 km from the actual
     waste, and that distance feeds the transport debit on the credit, so the
     person agreeing is told which location is being recorded rather than
     being left to assume we know where they are. A declaration made from a
     phone or a map pin should carry its real point and never come through
     this path. Raised on #63. */
  const input: DeclareWasteInput = { declaredBy, feedstock, tonnes, at, district };

  return {
    status: "write",
    /* The real numbers, not a hedge. The confirmation token is an HMAC bound
       to this intent and these slots, so what is summarised and what is
       called are guaranteed to be the same action - which makes naming the
       specifics safe, and hiding them pointless. */
    summary: msg(CONFIRM_KEY, { declaredBy, feedstock, tonnes, district }),
    call: { agent: "producer", skill: "declareWaste", input },
    done: (output) => {
      const lot = (output as { lot?: ResidueLot } | null)?.lot;
      /* Name the lot it became. "Recorded" with nothing to point at is the
         kind of confirmation nobody can check, and this one ends up in a
         ledger the whole pitch rests on being followable. */
      return msg(DONE_KEY, {
        lotId: lot?.lotId ?? "",
        tonnes: lot?.tonnes ?? tonnes,
        feedstock: lot?.feedstock ?? feedstock,
        district: lot?.district ?? district,
      });
    },
  };
};
