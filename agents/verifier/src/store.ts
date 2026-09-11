import { db, schema, eq } from "@charkha/db";
import type { FieldEvidence, VerifyEvidenceOutput } from "@charkha/core";
import type { MatchFacts, PriorEvidence } from "./skills/verifyEvidence.ts";

/**
 * OWNER: Hem
 *
 * Postgres-backed persistence for the verifier. Kept out of the skill so the
 * skill can be tested without a database. Ledger writes do NOT live here -
 * they go through appendDecision() and nothing else.
 */

export const findMatch = async (matchId: string): Promise<MatchFacts | null> => {
  const [row] = await db()
    .select({ assignedTonnes: schema.matches.assignedTonnes, lotFeedstock: schema.residueLots.feedstock })
    .from(schema.matches)
    .leftJoin(schema.residueLots, eq(schema.matches.lotId, schema.residueLots.lotId))
    .where(eq(schema.matches.matchId, matchId))
    .limit(1);
  return row ? { assignedTonnes: row.assignedTonnes, lotFeedstock: row.lotFeedstock ?? null } : null;
};

export const findPrior = async (evidenceId: string): Promise<PriorEvidence | null> => {
  const d = db();
  const [ev] = await d.select().from(schema.evidence).where(eq(schema.evidence.evidenceId, evidenceId)).limit(1);
  if (!ev) return null;
  const [ver] = await d
    .select()
    .from(schema.verifications)
    .where(eq(schema.verifications.evidenceId, evidenceId))
    .limit(1);
  const evidence: FieldEvidence = {
    evidenceId: ev.evidenceId,
    matchId: ev.matchId,
    at: { lat: ev.lat, lon: ev.lon },
    capturedAt: ev.capturedAt.toISOString(),
    imageHash: ev.imageHash,
    modelHash: ev.modelHash,
    modelVersion: ev.modelVersion,
    clientScores: ev.clientScores,
    batch: ev.batch as FieldEvidence["batch"],
  };
  const verification: VerifyEvidenceOutput | null = ver
    ? {
        evidenceId: ver.evidenceId,
        verdict: ver.verdict as VerifyEvidenceOutput["verdict"],
        charQualityScore: ver.charQualityScore,
        predictedClass: ver.predictedClass,
        confidence: ver.confidence,
        modelHash: ver.modelHash,
        modelVersion: ver.modelVersion,
        reasons: ver.reasons,
        methodologyChecks: ver.methodologyChecks as VerifyEvidenceOutput["methodologyChecks"],
      }
    : null;
  return { evidence, verification };
};

export const claimEvidence = async (e: FieldEvidence, _taskId: string): Promise<boolean> => {
  const inserted = await db()
    .insert(schema.evidence)
    .values({
      evidenceId: e.evidenceId,
      matchId: e.matchId,
      lat: e.at.lat,
      lon: e.at.lon,
      capturedAt: new Date(e.capturedAt),
      imageHash: e.imageHash,
      modelHash: e.modelHash,
      modelVersion: e.modelVersion,
      clientScores: e.clientScores,
      batch: e.batch,
    })
    .onConflictDoNothing()
    .returning({ evidenceId: schema.evidence.evidenceId });
  return inserted.length === 1;
};

export const saveVerification = async (v: VerifyEvidenceOutput, taskId: string): Promise<void> => {
  await db()
    .insert(schema.verifications)
    .values({ ...v, taskId })
    .onConflictDoNothing();
};
