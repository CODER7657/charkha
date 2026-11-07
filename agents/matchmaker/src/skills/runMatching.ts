import type { SkillContext } from "@charkha/a2a";
import type { z } from "zod";
import type { ConversionUnit, Match, ResidueLot, RunMatchingInput, RunMatchingOutput } from "@charkha/core";
import { newId } from "@charkha/core";
import { db, schema, and, eq, inArray, sql } from "@charkha/db";
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

/**
 * Reading the listed lots, deciding, and marking them matched has to be one
 * atomic step. Two rounds running at once would otherwise both see the same
 * lots as unassigned and both place them - `matches.lotId` is indexed, not
 * unique, so the duplicates would be accepted and the credit chain would fork
 * at the very join the trace is assembled from.
 *
 * Same advisory-lock pattern as the ledger, different key. Transaction-scoped,
 * so it releases on error too.
 */
const MATCHING_LOCK_KEY = 0x63686d21; // "chm!"

/** Capacity is per day, so the day is the window we count commitments over. */
const startOfUtcDay = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export const runMatching = async (
  input: z.infer<typeof RunMatchingInput>,
  ctx: SkillContext,
): Promise<z.infer<typeof RunMatchingOutput>> => {
  const d = db();

  const unitRows = await d.select().from(schema.conversionUnits);
  const units: ConversionUnit[] = unitRows.map((u) => ({
    unitId: u.unitId,
    name: u.name,
    at: { lat: u.lat, lon: u.lon },
    capacityTonnesPerDay: u.capacityTonnesPerDay,
    accepts: u.accepts as ConversionUnit["accepts"],
  }));

  if (units.length === 0) {
    // Nothing to match against is a setup problem, not a silent empty round.
    throw new Error("no conversion units registered - run `pnpm seed` first");
  }

  const decidedAt = new Date();

  const { matches, unmatched, listed } = await d.transaction(async (tx) => {
    // Blocks until we hold the matcher. Released at transaction end.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${MATCHING_LOCK_KEY})`);

    const lotRows = await tx
      .select()
      .from(schema.residueLots)
      .where(
        and(
          eq(schema.residueLots.status, "listed"),
          ...(input.district ? [eq(schema.residueLots.district, input.district)] : []),
        ),
      );

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

    // What earlier rounds already committed to each unit today. Without this
    // a second round hands every unit its full daily capacity again.
    const since = startOfUtcDay(decidedAt);
    const committedRows = await tx
      .select({ unitId: schema.matches.unitId, assignedTonnes: schema.matches.assignedTonnes })
      .from(schema.matches)
      .where(sql`${schema.matches.decidedAt} >= ${since}`);

    const committedTonnes: Record<string, number> = {};
    for (const r of committedRows) {
      committedTonnes[r.unitId] = (committedTonnes[r.unitId] ?? 0) + r.assignedTonnes;
    }

    const result = assign({ lots, units, maxRadiusKm: input.maxRadiusKm, committedTonnes });

    const decided: Match[] = result.assignments.map((a) => ({
      matchId: newId("match"),
      lotId: a.lotId,
      unitId: a.unitId,
      distanceKm: a.distanceKm,
      transportKgCo2e: a.transportKgCo2e,
      assignedTonnes: a.assignedTonnes,
      decidedAt: decidedAt.toISOString(),
      rationale: a.rationale,
    }));

    if (decided.length > 0) {
      await tx.insert(schema.matches).values(
        decided.map((m) => ({
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

      await tx
        .update(schema.residueLots)
        .set({ status: "matched" })
        .where(inArray(schema.residueLots.lotId, decided.map((m) => m.lotId)));
    }

    return { matches: decided, unmatched: result.unmatched, listed: lots.length };
  });

  ctx.progress(`${listed} listed lots, ${units.length} conversion units, radius ${input.maxRadiusKm} km`);
  for (const u of unmatched.slice(0, 5)) ctx.progress(`unmatched ${u.lotId}: ${u.reason}`);
  ctx.progress(`${matches.length} matched, ${unmatched.length} unmatched`);

  const output = {
    matches,
    unmatchedLotIds: unmatched.map((u) => u.lotId),
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
