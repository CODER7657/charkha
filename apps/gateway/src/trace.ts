import { readChain } from "@charkha/db/ledger";
import { verifyChain, type TraceBundle } from "@charkha/core";
import { db, schema, eq } from "@charkha/db";

/* ------------------------------------------------------------------ *
 * OWNER: core
 *
 * Assemble evidence -> decision -> credential for one A2A task id. This is
 * the thing a judge follows end to end, so it must never 500 and must
 * degrade gracefully: a task that only got as far as matching still returns
 * a bundle, with the later stages null.
 *
 * Only three tables carry a taskId (matches, verifications, credits). Lots
 * and evidence are reached by walking the foreign keys from whichever of
 * those three the task id hit.
 * ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : typeof v === "string" ? v : new Date(0).toISOString();

const toLot = (r: Row | undefined): TraceBundle["lot"] =>
  r
    ? {
        lotId: String(r["lotId"]),
        producerId: String(r["producerId"]),
        at: { lat: Number(r["lat"]), lon: Number(r["lon"]) },
        district: (r["district"] as string | null) ?? null,
        feedstock: r["feedstock"] as never,
        tonnes: Number(r["tonnes"]),
        availableFrom: iso(r["availableFrom"]),
        sourceDetectionId: (r["sourceDetectionId"] as string | null) ?? null,
        status: r["status"] as never,
      }
    : null;

const toMatch = (r: Row | undefined): TraceBundle["match"] =>
  r
    ? {
        matchId: String(r["matchId"]),
        lotId: String(r["lotId"]),
        unitId: String(r["unitId"]),
        distanceKm: Number(r["distanceKm"]),
        transportKgCo2e: Number(r["transportKgCo2e"]),
        assignedTonnes: Number(r["assignedTonnes"]),
        decidedAt: iso(r["decidedAt"]),
        rationale: String(r["rationale"]),
      }
    : null;

const toEvidence = (r: Row | undefined): TraceBundle["evidence"] =>
  r
    ? {
        evidenceId: String(r["evidenceId"]),
        matchId: String(r["matchId"]),
        at: { lat: Number(r["lat"]), lon: Number(r["lon"]) },
        capturedAt: iso(r["capturedAt"]),
        imageHash: String(r["imageHash"]),
        modelHash: String(r["modelHash"]),
        modelVersion: String(r["modelVersion"]),
        clientScores: (r["clientScores"] as Record<string, number>) ?? {},
        batch: r["batch"] as never,
      }
    : null;

const toVerification = (r: Row | undefined): TraceBundle["verification"] =>
  r
    ? {
        evidenceId: String(r["evidenceId"]),
        verdict: r["verdict"] as never,
        charQualityScore: Number(r["charQualityScore"]),
        predictedClass: String(r["predictedClass"]),
        confidence: Number(r["confidence"]),
        modelHash: String(r["modelHash"]),
        modelVersion: String(r["modelVersion"]),
        reasons: (r["reasons"] as string[]) ?? [],
        methodologyChecks: (r["methodologyChecks"] as never) ?? [],
      }
    : null;

const toCredit = (r: Row | undefined): TraceBundle["credit"] =>
  r
    ? {
        creditId: String(r["creditId"]),
        matchId: String(r["matchId"]),
        evidenceId: String(r["evidenceId"]),
        netTonnesCo2e: Number(r["netTonnesCo2e"]),
        breakdown: r["breakdown"] as never,
        issuedAt: iso(r["issuedAt"]),
        status: r["status"] as never,
        credentialJwt: String(r["credentialJwt"]),
        credentialId: String(r["credentialId"]),
        issuerDid: String(r["issuerDid"]),
      }
    : null;

export const buildTrace = async (taskId: string): Promise<TraceBundle | null> => {
  const d = db();

  const chain = await readChain(taskId);
  if (chain.length === 0) return null;

  const one = async <T>(rows: Promise<T[]>): Promise<T | undefined> => (await rows)[0];

  // Whichever stage this task id belongs to, start there.
  let match = await one(d.select().from(schema.matches).where(eq(schema.matches.taskId, taskId)).limit(1));
  let verification = await one(
    d.select().from(schema.verifications).where(eq(schema.verifications.taskId, taskId)).limit(1),
  );
  const credit = await one(d.select().from(schema.credits).where(eq(schema.credits.taskId, taskId)).limit(1));

  // Then walk outwards through the foreign keys to fill in the rest.
  let evidence = verification
    ? await one(
        d.select().from(schema.evidence).where(eq(schema.evidence.evidenceId, verification.evidenceId)).limit(1),
      )
    : undefined;

  if (credit) {
    evidence ??= await one(
      d.select().from(schema.evidence).where(eq(schema.evidence.evidenceId, credit.evidenceId)).limit(1),
    );
    verification ??= await one(
      d.select().from(schema.verifications).where(eq(schema.verifications.evidenceId, credit.evidenceId)).limit(1),
    );
    match ??= await one(d.select().from(schema.matches).where(eq(schema.matches.matchId, credit.matchId)).limit(1));
  }

  if (!match && evidence) {
    match = await one(d.select().from(schema.matches).where(eq(schema.matches.matchId, evidence.matchId)).limit(1));
  }

  const lot = match
    ? await one(d.select().from(schema.residueLots).where(eq(schema.residueLots.lotId, match.lotId)).limit(1))
    : undefined;

  // The full ledger is what is verifiable - a per-task slice links to records
  // belonging to other tasks, so verifying the slice alone proves nothing.
  const full = await readChain();

  return {
    taskId,
    lot: toLot(lot as Row | undefined),
    match: toMatch(match as Row | undefined),
    evidence: toEvidence(evidence as Row | undefined),
    verification: toVerification(verification as Row | undefined),
    credit: toCredit(credit as Row | undefined),
    chain,
    chainValid: verifyChain(full).valid,
  };
};
