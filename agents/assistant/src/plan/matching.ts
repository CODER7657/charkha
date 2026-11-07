import { msg, type Plan, type Planner } from "./types.ts";

/* ------------------------------------------------------------------ *
 * OWNER: core
 *
 * "Match my lots."
 *
 * This writes. A round creates matches and appends exactly one decision to an
 * append-only ledger, and rule 5 means that record can never be removed - so a
 * round run by accident is permanent, even when it matches nothing. That is
 * why this is a `write` plan and not a `read` one, despite feeling like a
 * harmless button.
 * ------------------------------------------------------------------ */

/** The default the contract uses. Restated nowhere - this is the display value only. */
const DEFAULT_RADIUS_KM = 60;

type MatchOutput = { matches?: unknown[]; unmatchedLotIds?: string[] };

export const planRunMatching: Planner = (slots): Plan => {
  const radiusKm = slots.radiusKm ?? DEFAULT_RADIUS_KM;

  return {
    status: "write",
    /* Names the radius, because it is the single number that decides the
       outcome and the one a person would want to change before agreeing. A
       summary saying only "run matching?" hides the whole decision. */
    summary: msg("assistant.matching.confirm", { radiusKm, district: slots.district ?? "" }),
    call: {
      agent: "matchmaker",
      skill: "runMatching",
      input: slots.district ? { maxRadiusKm: radiusKm, district: slots.district } : { maxRadiusKm: radiusKm },
    },
    done: (output) => {
      const out = (output ?? {}) as MatchOutput;
      const matched = out.matches?.length ?? 0;
      const unplaced = out.unmatchedLotIds?.length ?? 0;

      /* A round that placed nothing is a result, not a failure, and it must
         read as one. Six lots sitting 61-112 km from the nearest accepting
         unit is the catchment constraint working - the system looked and said
         so, and the ledger records that it looked. */
      if (matched === 0) {
        return msg("assistant.matching.none", { unplaced, radiusKm });
      }
      return msg("assistant.matching.done", { matched, unplaced, radiusKm });
    },
  };
};
