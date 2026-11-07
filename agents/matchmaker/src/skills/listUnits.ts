import type { SkillContext } from "@charkha/a2a";
import type { z } from "zod";
import type { ConversionUnit, ListUnitsInput, ListUnitsOutput } from "@charkha/core";
import { db, schema, asc } from "@charkha/db";

/**
 * OWNER: Harsh
 *
 * Read conversion_units, apply the feedstock filter, return them. Straight
 * query - keep it dull, same shape as producer.listLots.
 *
 * It lives on the matchmaker because conversion units are the matchmaker's
 * subject: it is the agent that reasons about their capacity and what they
 * accept. The operator map needs them to draw the unit layer and the
 * lot -> unit route lines.
 */
export const listUnits = async (
  input: z.infer<typeof ListUnitsInput>,
  ctx: SkillContext,
): Promise<z.infer<typeof ListUnitsOutput>> => {
  const rows = await db()
    .select()
    .from(schema.conversionUnits)
    // Stable order, so the map layer and the side panel do not reshuffle
    // between reloads.
    .orderBy(asc(schema.conversionUnits.unitId))
    .limit(input.limit);

  const units: ConversionUnit[] = rows
    .map((u) => ({
      unitId: u.unitId,
      name: u.name,
      at: { lat: u.lat, lon: u.lon },
      capacityTonnesPerDay: u.capacityTonnesPerDay,
      accepts: u.accepts as ConversionUnit["accepts"],
    }))
    // `accepts` is a jsonb array, so filter it here rather than reaching for a
    // jsonb containment operator over five rows.
    .filter((u) => (input.feedstock ? u.accepts.includes(input.feedstock) : true));

  ctx.progress(`${units.length} conversion units`);

  return { units };
};
