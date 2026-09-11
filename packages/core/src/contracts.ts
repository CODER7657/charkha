import { z } from "zod";

/* ------------------------------------------------------------------ *
 * THE CONTRACTS.
 *
 * Every agent boundary in Charkha is one of these schemas. If you need a
 * new field, add it here FIRST, in its own PR, and tell the channel - do
 * not widen a type inside your own agent. This file is why nobody has to
 * wait for anybody.
 *
 * Rule: parse at the boundary, never trust an inbound payload. Every skill
 * handler already receives a parsed, validated input.
 * ------------------------------------------------------------------ */

/* ---------- shared primitives ---------- */

export const GeoPoint = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});
export type GeoPoint = z.infer<typeof GeoPoint>;

export const FeedstockClass = z.enum(["paddy_straw", "wheat_straw", "sugarcane_trash", "maize_stover", "mixed"]);
export type FeedstockClass = z.infer<typeof FeedstockClass>;

/* ---------- PRODUCER  (owner: Harsh) ---------- */

/** One satellite fire detection, normalised from a FIRMS CSV row. */
export const BurnDetection = z.object({
  detectionId: z.string(),
  at: GeoPoint,
  acquiredAt: z.string().datetime(),
  satellite: z.string(),
  confidence: z.union([z.number(), z.string()]),
  frp: z.number().nullable(),
  district: z.string().nullable(),
});
export type BurnDetection = z.infer<typeof BurnDetection>;

/** A quantity of crop residue offered by a producer, ready to be collected. */
export const ResidueLot = z.object({
  lotId: z.string(),
  producerId: z.string(),
  at: GeoPoint,
  district: z.string().nullable(),
  feedstock: FeedstockClass,
  tonnes: z.number().positive(),
  availableFrom: z.string().datetime(),
  sourceDetectionId: z.string().nullable(),
  status: z.enum(["listed", "matched", "collected", "converted", "credited"]),
});
export type ResidueLot = z.infer<typeof ResidueLot>;

export const ListLotsInput = z.object({
  district: z.string().optional(),
  status: ResidueLot.shape.status.optional(),
  limit: z.number().int().min(1).max(500).default(100),
});
export const ListLotsOutput = z.object({ lots: z.array(ResidueLot) });

export const IngestBurnsInput = z.object({
  bbox: z.string().optional(),
  /**
   * FIRMS caps the area API's DAY_RANGE at 5 - the docs say "1 .. 5" and the
   * request form offers nothing higher. This was max(10), a bound we invented:
   * a 7 would have passed our validation and then been refused upstream, which
   * turns a clear "invalid input" into a confusing feed error.
   */
  dayRange: z.number().int().min(1).max(5).optional(),
});
/**
 * Where an ingest actually got its CSV. The producer falls back
 * live -> newest cached response -> bundled sample, so a populated map is
 * NOT evidence that the live feed answered.
 */
export const FeedOrigin = z.enum(["live", "cache", "fixture"]);
export type FeedOrigin = z.infer<typeof FeedOrigin>;

export const IngestBurnsOutput = z.object({
  fetched: z.number().int(),
  newDetections: z.number().int(),
  lotsCreated: z.number().int(),
  origin: FeedOrigin,
  /**
   * The same sentence the agent reports through ctx.progress(), carried on the
   * output so the operator view can render it. Names the cached file when it
   * used one, so "cached response from 14:02" is visible rather than implied.
   */
  originNote: z.string(),
});

/* ---------- MATCHMAKER  (owner: Harsh) ---------- */

export const ConversionUnit = z.object({
  unitId: z.string(),
  name: z.string(),
  at: GeoPoint,
  capacityTonnesPerDay: z.number().positive(),
  accepts: z.array(FeedstockClass),
});
export type ConversionUnit = z.infer<typeof ConversionUnit>;

/**
 * Conversion units are already public on the operator map - a processing site,
 * its capacity and what feedstock it takes. Nothing here is sensitive, and the
 * browser cannot draw the unit layer or a lot -> unit route without it.
 */
export const ListUnitsInput = z.object({
  /** Only units that accept this feedstock. */
  feedstock: FeedstockClass.optional(),
  limit: z.number().int().min(1).max(500).default(200),
});
export const ListUnitsOutput = z.object({ units: z.array(ConversionUnit) });

export const Match = z.object({
  matchId: z.string(),
  lotId: z.string(),
  unitId: z.string(),
  distanceKm: z.number().nonnegative(),
  transportKgCo2e: z.number().nonnegative(),
  assignedTonnes: z.number().positive(),
  decidedAt: z.string().datetime(),
  rationale: z.string(),
});
export type Match = z.infer<typeof Match>;

export const RunMatchingInput = z.object({
  district: z.string().optional(),
  maxRadiusKm: z.number().positive().default(60),
});
export const RunMatchingOutput = z.object({
  matches: z.array(Match),
  unmatchedLotIds: z.array(z.string()),
});

/* ---------- VERIFIER  (owner: Hem) ---------- */

/**
 * Evidence submitted from the field view.
 * NOTE: `imageHash` only. The photo itself never leaves the device - the
 * classifier runs in the browser via onnxruntime-web. If you ever find
 * yourself adding a base64 image field here, stop and ask in the channel.
 */
export const FieldEvidence = z.object({
  evidenceId: z.string(),
  matchId: z.string(),
  at: GeoPoint,
  capturedAt: z.string().datetime(),
  imageHash: z.string().length(64),
  modelHash: z.string().length(64),
  modelVersion: z.string(),
  clientScores: z.record(z.string(), z.number()),
  batch: z.object({
    pyrolysisPeakTempC: z.number(),
    residenceTimeMin: z.number(),
    feedstock: FeedstockClass,
    outputTonnes: z.number().positive(),
    hcOrgRatio: z.number().nullable(),
  }),
});
export type FieldEvidence = z.infer<typeof FieldEvidence>;

export const VerifyEvidenceInput = FieldEvidence;
export const VerifyEvidenceOutput = z.object({
  evidenceId: z.string(),
  verdict: z.enum(["accepted", "rejected", "needs_review"]),
  charQualityScore: z.number().min(0).max(1),
  predictedClass: z.string(),
  confidence: z.number().min(0).max(1),
  modelHash: z.string(),
  modelVersion: z.string(),
  reasons: z.array(z.string()),
  methodologyChecks: z.array(
    z.object({ check: z.string(), passed: z.boolean(), detail: z.string() }),
  ),
});
export type VerifyEvidenceOutput = z.infer<typeof VerifyEvidenceOutput>;

/* ---------- REGISTRY  (owner: Ayush) ---------- */

export const CreditRecord = z.object({
  creditId: z.string(),
  matchId: z.string(),
  evidenceId: z.string(),
  netTonnesCo2e: z.number(),
  breakdown: z.object({
    grossSequestrationTco2e: z.number(),
    transportDebitTco2e: z.number(),
    processDebitTco2e: z.number(),
  }),
  issuedAt: z.string().datetime(),
  status: z.enum(["issued", "retired", "revoked"]),
  credentialJwt: z.string(),
  credentialId: z.string(),
  issuerDid: z.string(),
  /**
   * Who holds this credit - the producer of the lot it came from.
   *
   * Retirement is terminal, irreversible and globally visible through the
   * status list, and credit ids are not secret: `GET /api/ledger` and
   * `GET /api/trace/:taskId` are unauthenticated, so two requests enumerate
   * every credit in the system. Without an owner, anyone could retire all of
   * them.
   *
   * This is a FIELD CHECK, not proven identity. It stops trivial
   * enumerate-and-retire and nothing more. Production needs a signed holder
   * presentation - say that plainly rather than implying otherwise.
   */
  holder: z.string().min(1),
  /**
   * Bit position this credential commits to in the published status list.
   *
   * Allocated atomically from a database sequence BEFORE signing. Deriving it
   * from a row count lets two concurrent issuances embed the same index, and
   * then retiring one credit sets the bit the other points at - leaving a
   * retired credit verifying as live, under our own signature.
   */
  statusListIndex: z.number().int().nonnegative(),
});
export type CreditRecord = z.infer<typeof CreditRecord>;

export const IssueCreditInput = z.object({
  matchId: z.string(),
  evidenceId: z.string(),
  verification: VerifyEvidenceOutput,
});
export const IssueCreditOutput = z.object({ credit: CreditRecord });

export const RetireCreditInput = z.object({
  creditId: z.string(),
  /** Must equal the credit's `holder`, or retirement is refused. */
  retiredBy: z.string().min(1),
  reason: z.string().default("voluntary retirement"),
});
export const RetireCreditOutput = z.object({ credit: CreditRecord });

/* ---------- DECISION LOG (shared, append-only) ---------- */

export const DecisionRecord = z.object({
  seq: z.number().int().nonnegative(),
  taskId: z.string(),
  agent: z.enum(["producer", "matchmaker", "verifier", "registry"]),
  agentCardId: z.string(),
  action: z.string(),
  inputHash: z.string().length(64),
  outputHash: z.string().length(64),
  modelHash: z.string().nullable(),
  confidence: z.number().nullable(),
  at: z.string().datetime(),
  prevHash: z.string(),
  hash: z.string().length(64),
});
export type DecisionRecord = z.infer<typeof DecisionRecord>;

/** The one thing a judge follows end to end. Gateway serves this by task id. */
export const TraceBundle = z.object({
  taskId: z.string(),
  lot: ResidueLot.nullable(),
  match: Match.nullable(),
  evidence: FieldEvidence.nullable(),
  verification: VerifyEvidenceOutput.nullable(),
  credit: CreditRecord.nullable(),
  chain: z.array(DecisionRecord),
  chainValid: z.boolean(),
});
export type TraceBundle = z.infer<typeof TraceBundle>;
