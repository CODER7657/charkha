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

  /* One transaction for the whole write. A detection row without its lot is
     unrecoverable: the next run reads `known` from burn_detections, sees the
     id, calls it a duplicate, and never creates the lot. Either both land or
     neither does.

     The counts come back from RETURNING, not from the plan - onConflictDoNothing
     means a racing ingest can insert nothing while planning plenty, and a
     decision record claiming lots it did not create is worse than no record. */
  const { newDetections, lotsCreated, plan } = await d.transaction(async (tx) => {
    const known = new Set(
      (await tx.select({ id: schema.burnDetections.detectionId }).from(schema.burnDetections)).map((r) => r.id),
    );
    const plan = planIngest(rows, known);
    if (plan.detections.length === 0) {
      return { newDetections: 0, lotsCreated: 0, plan };
    }

    const insertedDetections = await tx
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
      .onConflictDoNothing()
      .returning({ id: schema.burnDetections.detectionId });

    const insertedLots = await tx
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
      .onConflictDoNothing()
      .returning({ id: schema.residueLots.lotId });

    return { newDetections: insertedDetections.length, lotsCreated: insertedLots.length, plan };
  });

  ctx.progress(
    `${lotsCreated} new lots; skipped ${plan.skippedDuplicate} already seen, ` +
      `${plan.skippedLowConfidence} low-confidence, ${plan.skippedUnparseable} unreadable`,
  );

  const output = {
    fetched: plan.parsed,
    newDetections,
    lotsCreated,
  };

  // One decision per ingest round, including a round that found nothing - the
  // trace should show that we looked, not just that we found.
  //
  // `input` goes in exactly as the contract defines it. It used to carry the
  // feed origin too, which meant inputHash digested a payload that matched no
  // contract - an auditor re-hashing IngestBurnsInput would get a mismatch and
  // read it as tampering. Origin belongs on the OUTPUT, and that needs a field
  // on IngestBurnsOutput: separate one-file contracts PR. Until then it lives
  // in the progress stream above.
  await appendDecision({
    taskId: ctx.taskId,
    agent: "producer",
    agentCardId: AGENT_CARD_ID,
    action: "ingestBurns",
    input,
    output,
  });

  return output;
};
