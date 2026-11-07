import type { SkillContext } from "@charkha/a2a";
import type { z } from "zod";
import type { ListMatchesInput, ListMatchesOutput, MatchSummary } from "@charkha/core";
import { db, schema, desc, eq, isNull } from "@charkha/db";

/**
 * The matches a field worker could actually be standing in front of.
 *
 * Field capture demands a matchId and offered no way to get one - a free-text
 * box with a `match_...` placeholder. The only place a real id ever appeared
 * was the Operator result panel, which shows nothing once a round has spent
 * the day's capacity. So on any day after the first, a farmer with a phone and
 * a char pile could not obtain the id the form required.
 *
 * Joined rather than returned raw on purpose: nobody recognises a match by its
 * id. They recognise "Ludhiana Biochar Works, Sangrur, 4.2 t of paddy straw",
 * which is what the picker shows and what this returns.
 */
export const listMatches = async (
  input: z.infer<typeof ListMatchesInput>,
  ctx: SkillContext,
): Promise<z.infer<typeof ListMatchesOutput>> => {
  const rows = await db()
    .select({
      m: schema.matches,
      unitName: schema.conversionUnits.name,
      district: schema.residueLots.district,
      feedstock: schema.residueLots.feedstock,
      evidenceId: schema.evidence.evidenceId,
    })
    .from(schema.matches)
    .leftJoin(schema.conversionUnits, eq(schema.conversionUnits.unitId, schema.matches.unitId))
    .leftJoin(schema.residueLots, eq(schema.residueLots.lotId, schema.matches.lotId))
    /* Left, not inner: a match with no evidence is precisely the one we most
       want to return, and an inner join would drop every single one of them. */
    .leftJoin(schema.evidence, eq(schema.evidence.matchId, schema.matches.matchId))
    .where(input.awaitingEvidence ? isNull(schema.evidence.evidenceId) : undefined)
    // Newest first: the batch someone is standing in front of is a recent one.
    .orderBy(desc(schema.matches.decidedAt))
    .limit(input.limit);

  const matches: MatchSummary[] = rows.map((r) => ({
    matchId: r.m.matchId,
    lotId: r.m.lotId,
    unitId: r.m.unitId,
    distanceKm: r.m.distanceKm,
    transportKgCo2e: r.m.transportKgCo2e,
    assignedTonnes: r.m.assignedTonnes,
    decidedAt: r.m.decidedAt.toISOString(),
    rationale: r.m.rationale,
    /* The unit or lot row can be missing - a reseed has orphaned matches
       before. Say so rather than rendering "undefined" at a farmer. */
    unitName: r.unitName ?? r.m.unitId,
    district: r.district ?? null,
    feedstock: (r.feedstock ?? "mixed") as MatchSummary["feedstock"],
    hasEvidence: r.evidenceId !== null,
  }));

  ctx.progress(`${matches.length} matches${input.awaitingEvidence ? " awaiting evidence" : ""}`);

  return { matches };
};
