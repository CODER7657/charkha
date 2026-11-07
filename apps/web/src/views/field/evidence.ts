import type { FieldEvidence, FeedstockClass, GeoPoint } from "@charkha/core";
import { packClientScores, type ClassScores } from "../../../../../agents/verifier/src/protocol.ts";

/**
 * OWNER: Hem
 *
 * The ONLY place the evidence request body is assembled. It is built from an
 * explicit list of fields, never by spreading form state, so nothing extra -
 * least of all the photo - can ride along. evidence.test.ts pins the shape.
 */

export type BatchForm = {
  pyrolysisPeakTempC: string;
  residenceTimeMin: string;
  feedstock: FeedstockClass;
  outputTonnes: string;
  hcOrgRatio: string;
};

export type Scored = {
  imageHash: string;
  modelHash: string;
  modelVersion: string;
  photo: ClassScores;
  canary: ClassScores;
};

const num = (label: string, raw: string): number => {
  const n = Number(raw.trim());
  if (raw.trim() === "" || !Number.isFinite(n)) throw new Error(`${label} must be a number`);
  return n;
};

export const buildEvidence = (args: {
  evidenceId: string;
  matchId: string;
  at: GeoPoint;
  capturedAt: Date;
  scored: Scored;
  batch: BatchForm;
}): FieldEvidence => {
  const { scored, batch } = args;
  const hc = batch.hcOrgRatio.trim();
  if (!args.matchId.trim()) throw new Error("match id is required");
  return {
    evidenceId: args.evidenceId,
    matchId: args.matchId.trim(),
    at: { lat: args.at.lat, lon: args.at.lon },
    capturedAt: args.capturedAt.toISOString(),
    imageHash: scored.imageHash,
    modelHash: scored.modelHash,
    modelVersion: scored.modelVersion,
    clientScores: packClientScores(scored.photo, scored.canary),
    batch: {
      pyrolysisPeakTempC: num("peak temperature", batch.pyrolysisPeakTempC),
      residenceTimeMin: num("residence time", batch.residenceTimeMin),
      feedstock: batch.feedstock,
      outputTonnes: num("output tonnes", batch.outputTonnes),
      hcOrgRatio: hc === "" ? null : num("H/C ratio", hc),
    },
  };
};

/** crypto.randomUUID is secure-context only, which we already require for hashing. */
export const newEvidenceId = (): string => `ev_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
