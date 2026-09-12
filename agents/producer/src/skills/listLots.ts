import type { SkillContext } from "@charkha/a2a";
import type { z } from "zod";
import type { ListLotsInput, ListLotsOutput, ResidueLot } from "@charkha/core";
import { db, schema, and, eq, desc } from "@charkha/db";

/**
 * OWNER: Harsh
 * Read residue_lots, apply filters, return them. Straight query - keep it dull.
 */
export const listLots = async (
  input: z.infer<typeof ListLotsInput>,
  ctx: SkillContext,
): Promise<z.infer<typeof ListLotsOutput>> => {
  const filters = [
    ...(input.district ? [eq(schema.residueLots.district, input.district)] : []),
    ...(input.status ? [eq(schema.residueLots.status, input.status)] : []),
  ];

  const rows = await db()
    .select()
    .from(schema.residueLots)
    .where(filters.length > 0 ? and(...filters) : undefined)
    // Newest residue first: an operator cares about the field that is
    // burning today, not one from last week.
    .orderBy(desc(schema.residueLots.availableFrom))
    .limit(input.limit);

  ctx.progress(`${rows.length} lots`);

  const lots: ResidueLot[] = rows.map((r) => ({
    lotId: r.lotId,
    producerId: r.producerId,
    at: { lat: r.lat, lon: r.lon },
    district: r.district,
    feedstock: r.feedstock as ResidueLot["feedstock"],
    tonnes: r.tonnes,
    availableFrom: r.availableFrom.toISOString(),
    sourceDetectionId: r.sourceDetectionId,
    status: r.status as ResidueLot["status"],
    /* Carried out of the query deliberately.
    
       Detected and declared lots are different evidence - one is a thermal
       anomaly NASA saw whether or not anyone wanted it seen, the other a
       claim by somebody who stands to be paid for it. A reader that cannot
       tell them apart is exactly the blur this column exists to prevent, and
       dropping the field here would have made the distinction invisible
       everywhere downstream of the producer. */
    origin: r.origin as ResidueLot["origin"],
  }));

  return { lots };
};
