import { pgTable, pgSequence, text, doublePrecision, integer, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Status-list bit positions. A sequence, not a row count, because the index
 * must be allocated atomically BEFORE the credential is signed. Gaps are
 * fine; collisions are not. Allocate with nextStatusListIndex().
 */
export const creditStatusListIndexSeq = pgSequence("credit_status_list_index_seq", { startWith: 0, minValue: 0 });

/* One table per contract in @charkha/core. Keep them in step: if you add a
   field to a contract, add the column in the SAME PR. */

export const burnDetections = pgTable(
  "burn_detections",
  {
    detectionId: text("detection_id").primaryKey(),
    lat: doublePrecision("lat").notNull(),
    lon: doublePrecision("lon").notNull(),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull(),
    satellite: text("satellite").notNull(),
    confidence: text("confidence").notNull(),
    frp: doublePrecision("frp"),
    district: text("district"),
  },
  (t) => [index("burn_district_idx").on(t.district)],
);

export const residueLots = pgTable(
  "residue_lots",
  {
    lotId: text("lot_id").primaryKey(),
    producerId: text("producer_id").notNull(),
    lat: doublePrecision("lat").notNull(),
    lon: doublePrecision("lon").notNull(),
    district: text("district"),
    feedstock: text("feedstock").notNull(),
    tonnes: doublePrecision("tonnes").notNull(),
    availableFrom: timestamp("available_from", { withTimezone: true }).notNull(),
    sourceDetectionId: text("source_detection_id"),
    status: text("status").notNull().default("listed"),
  },
  (t) => [index("lot_status_idx").on(t.status)],
);

export const conversionUnits = pgTable("conversion_units", {
  unitId: text("unit_id").primaryKey(),
  name: text("name").notNull(),
  lat: doublePrecision("lat").notNull(),
  lon: doublePrecision("lon").notNull(),
  capacityTonnesPerDay: doublePrecision("capacity_tonnes_per_day").notNull(),
  accepts: jsonb("accepts").$type<string[]>().notNull(),
});

export const matches = pgTable(
  "matches",
  {
    matchId: text("match_id").primaryKey(),
    lotId: text("lot_id").notNull(),
    unitId: text("unit_id").notNull(),
    distanceKm: doublePrecision("distance_km").notNull(),
    transportKgCo2e: doublePrecision("transport_kg_co2e").notNull(),
    assignedTonnes: doublePrecision("assigned_tonnes").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
    rationale: text("rationale").notNull(),
    taskId: text("task_id"),
  },
  (t) => [index("match_lot_idx").on(t.lotId)],
);

export const evidence = pgTable("evidence", {
  evidenceId: text("evidence_id").primaryKey(),
  matchId: text("match_id").notNull(),
  lat: doublePrecision("lat").notNull(),
  lon: doublePrecision("lon").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  imageHash: text("image_hash").notNull(),
  modelHash: text("model_hash").notNull(),
  modelVersion: text("model_version").notNull(),
  clientScores: jsonb("client_scores").$type<Record<string, number>>().notNull(),
  batch: jsonb("batch").$type<Record<string, unknown>>().notNull(),
});

export const verifications = pgTable("verifications", {
  evidenceId: text("evidence_id").primaryKey(),
  verdict: text("verdict").notNull(),
  charQualityScore: doublePrecision("char_quality_score").notNull(),
  predictedClass: text("predicted_class").notNull(),
  confidence: doublePrecision("confidence").notNull(),
  modelHash: text("model_hash").notNull(),
  modelVersion: text("model_version").notNull(),
  reasons: jsonb("reasons").$type<string[]>().notNull(),
  methodologyChecks: jsonb("methodology_checks").$type<unknown[]>().notNull(),
  taskId: text("task_id"),
});

export const credits = pgTable(
  "credits",
  {
    creditId: text("credit_id").primaryKey(),
    matchId: text("match_id").notNull(),
    evidenceId: text("evidence_id").notNull(),
    netTonnesCo2e: doublePrecision("net_tonnes_co2e").notNull(),
    breakdown: jsonb("breakdown").$type<Record<string, number>>().notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("issued"),
    credentialJwt: text("credential_jwt").notNull(),
    credentialId: text("credential_id").notNull(),
    issuerDid: text("issuer_did").notNull(),
    taskId: text("task_id"),
    /* Who holds it. Retirement refuses unless retiredBy matches. */
    holder: text("holder").notNull(),
    /* Bit position in the published status list. MUST come from
       nextStatusListIndex() before signing - a value derived from a row count
       reproduces the race this column exists to close. */
    statusListIndex: integer("status_list_index").notNull(),
  },
  (t) => [
    index("credit_status_idx").on(t.status),
    index("credit_holder_idx").on(t.holder),
    /* Two credentials must never commit to the same bit. */
    uniqueIndex("credit_status_list_index_uq").on(t.statusListIndex),
    /* One credit per batch of evidence, ever. The registry checks this before
       it issues, but a check-then-insert cannot hold across concurrent
       requests or multiple registry processes - the database is the only
       place this guarantee can actually live. */
    uniqueIndex("credit_evidence_uq").on(t.evidenceId),
  ],
);

/** Append-only. Never UPDATE or DELETE a row here - that is the whole point. */
export const decisionLog = pgTable(
  "decision_log",
  {
    seq: integer("seq").primaryKey(),
    taskId: text("task_id").notNull(),
    agent: text("agent").notNull(),
    agentCardId: text("agent_card_id").notNull(),
    action: text("action").notNull(),
    inputHash: text("input_hash").notNull(),
    outputHash: text("output_hash").notNull(),
    modelHash: text("model_hash"),
    confidence: doublePrecision("confidence"),
    at: timestamp("at", { withTimezone: true }).notNull(),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
  },
  (t) => [index("decision_task_idx").on(t.taskId)],
);
