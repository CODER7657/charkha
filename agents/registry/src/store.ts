import { db, schema, eq, desc, asc } from "@charkha/db";
import { appendDecision } from "@charkha/db/ledger";
import { GENESIS_HASH, type CreditRecord, type DecisionRecord, type FieldEvidence, type Match } from "@charkha/core";

/* ------------------------------------------------------------------ *
 * The registry's view of storage, as an interface.
 *
 * Everything the issuance and retirement rules need, and nothing else.
 * The real implementation is drizzle; the tests run the SAME rules against
 * an in-memory one, which is why the double-counting guard can be tested
 * in CI where there is no database.
 * ------------------------------------------------------------------ */

export type AppendDecisionArgs = Parameters<typeof appendDecision>[0];

export type RegistryStore = {
  findMatch: (matchId: string) => Promise<Match | null>;
  findEvidence: (evidenceId: string) => Promise<FieldEvidence | null>;
  findCreditByEvidenceId: (evidenceId: string) => Promise<CreditRecord | null>;
  findCreditById: (creditId: string) => Promise<CreditRecord | null>;
  /** Issued credits in issuance order. The position in this list is the status-list index. */
  listCredits: () => Promise<CreditRecord[]>;
  insertCredit: (credit: CreditRecord, taskId: string) => Promise<void>;
  /** Retirement is the only state change a credit ever undergoes. */
  markRetired: (creditId: string) => Promise<CreditRecord>;
  /** Hash of the newest decision - the chain-of-custody pointer we put in the VC. */
  headDecisionHash: () => Promise<string>;
  appendDecision: (args: AppendDecisionArgs) => Promise<DecisionRecord>;
};

const creditFromRow = (row: typeof schema.credits.$inferSelect): CreditRecord => ({
  creditId: row.creditId,
  matchId: row.matchId,
  evidenceId: row.evidenceId,
  netTonnesCo2e: row.netTonnesCo2e,
  breakdown: row.breakdown as CreditRecord["breakdown"],
  issuedAt: row.issuedAt.toISOString(),
  status: row.status as CreditRecord["status"],
  credentialJwt: row.credentialJwt,
  credentialId: row.credentialId,
  issuerDid: row.issuerDid,
});

export const dbStore = (): RegistryStore => ({
  findMatch: async (matchId) => {
    const [row] = await db().select().from(schema.matches).where(eq(schema.matches.matchId, matchId)).limit(1);
    if (!row) return null;
    return {
      matchId: row.matchId,
      lotId: row.lotId,
      unitId: row.unitId,
      distanceKm: row.distanceKm,
      transportKgCo2e: row.transportKgCo2e,
      assignedTonnes: row.assignedTonnes,
      decidedAt: row.decidedAt.toISOString(),
      rationale: row.rationale,
    };
  },

  findEvidence: async (evidenceId) => {
    const [row] = await db().select().from(schema.evidence).where(eq(schema.evidence.evidenceId, evidenceId)).limit(1);
    if (!row) return null;
    return {
      evidenceId: row.evidenceId,
      matchId: row.matchId,
      at: { lat: row.lat, lon: row.lon },
      capturedAt: row.capturedAt.toISOString(),
      imageHash: row.imageHash,
      modelHash: row.modelHash,
      modelVersion: row.modelVersion,
      clientScores: row.clientScores,
      batch: row.batch as FieldEvidence["batch"],
    };
  },

  findCreditByEvidenceId: async (evidenceId) => {
    const [row] = await db().select().from(schema.credits).where(eq(schema.credits.evidenceId, evidenceId)).limit(1);
    return row ? creditFromRow(row) : null;
  },

  findCreditById: async (creditId) => {
    const [row] = await db().select().from(schema.credits).where(eq(schema.credits.creditId, creditId)).limit(1);
    return row ? creditFromRow(row) : null;
  },

  listCredits: async () => {
    const rows = await db().select().from(schema.credits).orderBy(asc(schema.credits.issuedAt), asc(schema.credits.creditId));
    return rows.map(creditFromRow);
  },

  insertCredit: async (credit, taskId) => {
    await db()
      .insert(schema.credits)
      .values({ ...credit, issuedAt: new Date(credit.issuedAt), taskId });
  },

  markRetired: async (creditId) => {
    const [row] = await db()
      .update(schema.credits)
      .set({ status: "retired" })
      .where(eq(schema.credits.creditId, creditId))
      .returning();
    if (!row) throw new Error(`no such credit: ${creditId}`);
    return creditFromRow(row);
  },

  headDecisionHash: async () => {
    const [row] = await db().select().from(schema.decisionLog).orderBy(desc(schema.decisionLog.seq)).limit(1);
    return row?.hash ?? GENESIS_HASH;
  },

  appendDecision,
});
