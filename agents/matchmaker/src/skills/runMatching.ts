import type { SkillContext } from "@charkha/a2a";
import type { z } from "zod";
import { RunMatchingInput, type RunMatchingOutput } from "@charkha/core";

/**
 * OWNER: Harsh
 *
 * Assign listed lots to conversion units.
 *
 * ALGORITHM - greedy, and that is deliberate. Do NOT reach for an MILP
 * solver or OR-Tools; a solver is not where the marks are and it will eat
 * your Saturday.
 *
 *   1. sort lots by tonnes descending (big lots are hardest to place)
 *   2. for each lot, candidate units = accepts[feedstock]
 *                                      && roadDistanceKm <= maxRadiusKm
 *                                      && remaining capacity > 0
 *   3. pick the candidate minimising transport debit (roadDistanceKm * tonnes)
 *   4. decrement that unit's remaining capacity for the round
 *   5. anything unplaced goes to unmatchedLotIds with a reason
 *
 * Use roadDistanceKm() and transportKgCo2e() from @charkha/core - do not
 * re-implement distance or emission maths locally.
 *
 * Write a human-readable `rationale` on every match ("nearest accepting unit,
 * 14.2 km, 21 t capacity free"). The operator view renders it verbatim and it
 * is what makes the decision look considered rather than random.
 *
 * Append one decision to the ledger per matching round.
 */
export const runMatching = async (
  input: z.infer<typeof RunMatchingInput>,
  ctx: SkillContext,
): Promise<z.infer<typeof RunMatchingOutput>> => {
  ctx.progress("TODO(harsh): greedy assignment over capacity + radius");
  void input;
  return { matches: [], unmatchedLotIds: [] };
};
