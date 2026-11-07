import type { ResidueLot } from "@charkha/core";
import { FACTORS, computeCredit } from "@charkha/core";
import { msg, type Plan, type Planner } from "./types.ts";

/* ------------------------------------------------------------------ *
 * OWNER: core
 *
 * "What happened to our waste?" and "how much did our district sequester?"
 *
 * These are the two questions the users this project is written for actually
 * have - a panchayat and a municipal ward want to know where their residue
 * went and whether it was worth anything. Both are reads, so both run without
 * confirmation.
 * ------------------------------------------------------------------ */

type LotsOutput = { lots: ResidueLot[] };

const lotsOf = (outputs: unknown[]): ResidueLot[] =>
  ((outputs[0] as LotsOutput | undefined)?.lots ?? []).filter(Boolean);

/** Reads as detected unless it says declared - never the other way round. */
const isDeclared = (lot: ResidueLot): boolean => lot.origin === "declared";

const round = (n: number): number => Math.round(n * 100) / 100;

/**
 * Where a district's waste got to.
 *
 * Answers with counts by status rather than a list, because a ward with forty
 * lots does not want forty lines - it wants to know how many are still
 * waiting. The UI can render the rows from `data`.
 */
export const planLotStatus: Planner = (slots): Plan => {
  if (!slots.district && !slots.lotId) {
    return { status: "need", reply: msg("assistant.lots.need_district") };
  }

  return {
    status: "read",
    calls: [
      {
        agent: "producer",
        skill: "listLots",
        input: slots.district ? { district: slots.district, limit: 200 } : { limit: 200 },
      },
    ],
    reply: (outputs) => {
      let lots = lotsOf(outputs);
      if (slots.lotId) lots = lots.filter((l) => l.lotId === slots.lotId);

      if (lots.length === 0) {
        return msg("assistant.lots.none", { district: slots.district ?? "" });
      }

      const by = (status: ResidueLot["status"]) => lots.filter((l) => l.status === status).length;
      const tonnes = round(lots.reduce((sum, l) => sum + l.tonnes, 0));

      return msg("assistant.lots.summary", {
        district: slots.district ?? "",
        total: lots.length,
        tonnes,
        listed: by("listed"),
        matched: by("matched"),
        credited: by("credited"),
        /* Surfaced separately because the two are different evidence and the
           answer should not quietly average them. A ward that declared its own
           waste is told how much of this is its own word. */
        declared: lots.filter(isDeclared).length,
      });
    },
  };
};

/**
 * "How much CO2 did we sequester?"
 *
 * Deliberately an ESTIMATE of what the listed and matched waste could
 * sequester, clearly separated from what has actually been credited. Reporting
 * potential as achieved is the single easiest way for a carbon system to lie,
 * and it is the thing an incentive scheme would be defrauded with.
 */
export const planImpactSummary: Planner = (slots): Plan => {
  if (!slots.district) {
    return { status: "need", reply: msg("assistant.impact.need_district") };
  }

  return {
    status: "read",
    calls: [
      { agent: "producer", skill: "listLots", input: { district: slots.district, limit: 500 } },
    ],
    reply: (outputs) => {
      const lots = lotsOf(outputs);
      if (lots.length === 0) return msg("assistant.impact.none", { district: slots.district ?? "" });

      const tonnes = lots.reduce((sum, l) => sum + l.tonnes, 0);
      const credited = lots.filter((l) => l.status === "credited");
      const creditedTonnes = credited.reduce((sum, l) => sum + l.tonnes, 0);

      /* computeCredit, not a formula of our own.
      
         The sequestration factor is per tonne of BIOCHAR, and a lot is
         measured in feedstock - multiplying the two directly overstates the
         answer by the whole yield step. More to the point, a second
         implementation of the carbon maths living in the assistant is exactly
         what this agent is not allowed to grow: there would be two answers to
         "what is this worth" and only one of them would be tested.
      
         transportKm 0 and quality 1 make this an explicit CEILING, not a
         forecast, and the reply key says so. Reporting potential as achieved
         is the easiest way for a carbon system to lie, and it is what an
         incentive scheme would be defrauded with - so credited is reported
         separately and never folded in. */
      const ceiling = (t: number) =>
        round(computeCredit({ feedstockTonnes: t, transportKm: 0, qualityScore: 1 }).grossSequestrationTco2e);

      return msg("assistant.impact.summary", {
        district: slots.district ?? "",
        lots: lots.length,
        tonnes: round(tonnes),
        potentialTco2e: ceiling(tonnes),
        creditedLots: credited.length,
        creditedTco2e: ceiling(creditedTonnes),
        yieldFactor: FACTORS.biocharYieldFromFeedstock.value,
        factor: FACTORS.biocharSequestrationPerTonne.value,
        source: FACTORS.biocharSequestrationPerTonne.source,
      });
    },
  };
};
