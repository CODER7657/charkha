import type { SkillContext } from "@charkha/a2a";
import type { z } from "zod";
import type { IngestBurnsInput, IngestBurnsOutput } from "@charkha/core";
import { db, schema } from "@charkha/db";
import { appendDecision } from "@charkha/db/ledger";
import { AGENT_CARD_ID } from "../card.ts";
import { loadFirmsCsv } from "../feed.ts";
import { parseCsv, planIngest } from "../firms.ts";

/**
 * OWNER: Harsh
 *
 * Pull fire detections and turn them into residue lots.
 *
 * The shape of this handler is deliberate: every decision about what becomes
 * a lot lives in the pure `planIngest` in firms.ts, and everything here is
 * I/O. That is what makes the dedupe guarantee testable without a database.
 *
 *   feed (live -> cache -> bundled sample)  ->  parse  ->  plan  ->  insert
 *
 * Dedupe: detection ids are derived from (satellite, lat, lon, date, time),
 * so the same overpass always yields the same id. Running ingest twice does
 * not create a second lot - see ingestBurns.test.ts.
 */
export const ingestBurns = async (
  input: z.infer<typeof IngestBurnsInput>,
  ctx: SkillContext,
): Promise<z.infer<typeof IngestBurnsOutput>> => {
  const feed = await loadFirmsCsv({
    ...(input.bbox ? { bbox: input.bbox } : {}),
    ...(input.dayRange ? { dayRange: input.dayRange } : {}),
  });
  ctx.progress(feed.note);

  const rows = parseCsv(feed.csv);
  ctx.progress(`parsed ${rows.length} rows`);

  const d = db();
  const known = new Set(
    (await d.select({ id: schema.burnDetections.detectionId }).from(schema.burnDetections)).map((r) => r.id),
  );
  const plan = planIngest(rows, known);

  if (plan.detections.length > 0) {
    await d
      .insert(schema.burnDetections)
      .values(
        plan.detections.map((x) => ({
          detectionId: x.detectionId,
          lat: x.at.lat,
          lon: x.at.lon,
          acquiredAt: new Date(x.acquiredAt),
          satellite: x.satellite,
          confidence: String(x.confidence),
          frp: x.frp,
          district: x.district,
        })),
      )
      // Belt and braces: the id is already stable, this also survives two
      // ingests racing each other.
      .onConflictDoNothing();

    await d
      .insert(schema.residueLots)
      .values(
        plan.lots.map((l) => ({
          lotId: l.lotId,
          producerId: l.producerId,
          lat: l.at.lat,
          lon: l.at.lon,
          district: l.district,
          feedstock: l.feedstock,
          tonnes: l.tonnes,
          availableFrom: new Date(l.availableFrom),
          sourceDetectionId: l.sourceDetectionId,
          status: l.status,
        })),
      )
      .onConflictDoNothing();
  }

  ctx.progress(
    `${plan.lots.length} new lots; skipped ${plan.skippedDuplicate} already seen, ` +
      `${plan.skippedLowConfidence} low-confidence, ${plan.skippedUnparseable} unreadable`,
  );

  const output = {
    fetched: plan.parsed,
    newDetections: plan.detections.length,
    lotsCreated: plan.lots.length,
  };

  // One decision per ingest round, including a round that found nothing - the
  // trace should show that we looked, not just that we found.
  await appendDecision({
    taskId: ctx.taskId,
    agent: "producer",
    agentCardId: AGENT_CARD_ID,
    action: "ingestBurns",
    input: { ...input, origin: feed.origin },
    output,
  });

  return output;
};
