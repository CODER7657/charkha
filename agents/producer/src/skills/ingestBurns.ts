import type { SkillContext } from "@charkha/a2a";
import type { z } from "zod";
import { IngestBurnsInput, type IngestBurnsOutput } from "@charkha/core";

/**
 * OWNER: Harsh
 *
 * Pull fire detections and turn them into residue lots.
 *
 * Endpoint shape (verified against the live docs):
 *   https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/{SOURCE}/{west,south,east,north}/{dayRange}
 * Free MAP_KEY, 5000 calls per 10 minutes. Response is CSV with a header row.
 *
 * REQUIREMENTS
 *  - dedupe on detectionId; re-running must not create duplicate lots
 *  - cache raw responses under data/firms-cache/ so the demo survives dead wifi
 *  - if FIRMS_MAP_KEY is missing, fall back to the cached fixture and say so
 *    in ctx.progress() - never fail the demo on a network blip
 *  - estimate tonnes from FRP + a per-district default; document the assumption
 *  - append one decision to the ledger via appendDecision()
 */
export const ingestBurns = async (
  input: z.infer<typeof IngestBurnsInput>,
  ctx: SkillContext,
): Promise<z.infer<typeof IngestBurnsOutput>> => {
  ctx.progress("TODO(harsh): fetch FIRMS, dedupe, create lots");
  void input;
  return { fetched: 0, newDetections: 0, lotsCreated: 0 };
};
