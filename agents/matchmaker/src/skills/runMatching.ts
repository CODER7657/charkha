import type { SkillContext } from "@charkha/a2a";
import type { z } from "zod";
import type { ConversionUnit, Match, ResidueLot, RunMatchingInput, RunMatchingOutput } from "@charkha/core";
import { newId } from "@charkha/core";
import { db, schema, and, eq, inArray } from "@charkha/db";
import { appendDecision } from "@charkha/db/ledger";
import { AGENT_CARD_ID } from "../card.ts";
import { assign } from "../matching.ts";

/**
 * OWNER: Harsh
 *
 * One matching round. The algorithm is in matching.ts and is pure; this is
 * the I/O around it - read what is listed, write what was decided.
 *
 * Only lots with status "listed" enter a round, and every lot that gets
 * placed leaves it as "matched". Running the round twice therefore does not
 * assign the same lot to a second unit.
 */
export const runMatching = async (
  input: z.infer<typeof RunMatchingInput>,
  ctx: SkillContext,
): Promise<z.infer<typeof RunMatchingOutput>> => {
  const d = db();

  const lotFilters = [
    eq(schema.residueLots.status, "listed"),
    ...(input.district ? [eq(schema.residueLots.district, input.district)] : []),
  ];

  const [lotRows, unitRows] = await Promise.all([
    d.select().from(schema.residueLots).where(and(...lotFilters)),
    d.select().from(schema.conversionUnits),
  ]);

  const lots: ResidueLot[] = lotRows.map((r) => ({
    lotId: r.lotId,
    producerId: r.producerId,
    at: { lat: r.lat, lon: r.lon },
    district: r.district,
    feedstock: r.feedstock as ResidueLot["feedstock"],
    tonnes: r.tonnes,
    availableFrom: r.availableFrom.toISOString(),
    sourceDetectionId: r.sourceDetectionId,
    status: r.status as ResidueLot["status"],
  }));

  const units: ConversionUnit[] = unitRows.map((u) => ({
    unitId: u.unitId,
    name: u.name,
    at: { lat: u.lat, lon: u.lon },
    capacityTonnesPerDay: u.capacityTonnesPerDay,
    accepts: u.accepts as ConversionUnit["accepts"],
  }));

  ctx.progress(`${lots.length} listed lots, ${units.length} conversion units, radius ${input.maxRadiusKm} km`);

  if (units.length === 0) {
    // Nothing to match against is a setup problem, not a silent empty round.
    throw new Error("no conversion units registered - run `pnpm seed` first");
  }

  const result = assign({ lots, units, maxRadiusKm: input.maxRadiusKm });

  const decidedAt = new Date();
  const matches: Match[] = result.assignments.map((a) => ({
    matchId: newId("match"),
    lotId: a.lotId,
    unitId: a.unitId,
    distanceKm: a.distanceKm,
    transportKgCo2e: a.transportKgCo2e,
    assignedTonnes: a.assignedTonnes,
    decidedAt: decidedAt.toISOString(),
    rationale: a.rationale,
  }));

  if (matches.length > 0) {
    await d.insert(schema.matches).values(
      matches.map((m) => ({
        matchId: m.matchId,
        lotId: m.lotId,
        unitId: m.unitId,
        distanceKm: m.distanceKm,
        transportKgCo2e: m.transportKgCo2e,
        assignedTonnes: m.assignedTonnes,
        decidedAt,
        rationale: m.rationale,
        // Threads this round onto the task id the trace is assembled from.
        taskId: ctx.taskId,
      })),
    );

    await d
      .update(schema.residueLots)
      .set({ status: "matched" })
      .where(inArray(schema.residueLots.lotId, matches.map((m) => m.lotId)));
  }

  for (const u of result.unmatched.slice(0, 5)) ctx.progress(`unmatched ${u.lotId}: ${u.reason}`);
  ctx.progress(`${matches.length} matched, ${result.unmatched.length} unmatched`);

  const output = {
    matches,
    unmatchedLotIds: result.unmatched.map((u) => u.lotId),
  };

  // One decision per round. The reasons unplaced lots stayed unplaced are in
  // the progress stream, not in the output - widening RunMatchingOutput to
  // carry them is a contracts.ts change, and that is a separate PR.
  await appendDecision({
    taskId: ctx.taskId,
    agent: "matchmaker",
    agentCardId: AGENT_CARD_ID,
    action: "runMatching",
    input,
    output,
  });

  return output;
};
