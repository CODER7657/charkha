import { linkDecision, verifyChain, hashPayload, type DecisionRecord } from "@charkha/core";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "./index.ts";
import { decisionLog } from "./schema.ts";

/* ------------------------------------------------------------------ *
 * The chain of custody. Every agent calls `appendDecision` exactly once
 * per meaningful decision. Never write to decision_log any other way.
 * ------------------------------------------------------------------ */

/**
 * Appending is read-then-write: find the tail, hash onto it, insert. Four
 * agents doing that at once will interleave, and two records claiming the
 * same `prevHash` is a broken chain - the one failure that would discredit
 * the whole pitch.
 *
 * A Postgres transaction-scoped advisory lock serialises appends across every
 * process and connection, and releases automatically when the transaction
 * ends - including on error, so a crashed agent cannot wedge the ledger.
 *
 * The key is arbitrary but must be identical everywhere. Do not change it.
 */
const LEDGER_LOCK_KEY = 0x63687221; // "chr!"

const toRecord = (row: typeof decisionLog.$inferSelect): DecisionRecord =>
  ({ ...row, at: row.at.toISOString() }) as DecisionRecord;

export const appendDecision = async (args: {
  taskId: string;
  agent: DecisionRecord["agent"];
  agentCardId: string;
  action: string;
  input: unknown;
  output: unknown;
  modelHash?: string | null;
  confidence?: number | null;
}): Promise<DecisionRecord> => {
  const d = db();

  return d.transaction(async (tx) => {
    // Blocks until we hold the ledger. Released at transaction end.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${LEDGER_LOCK_KEY})`);

    const [last] = await tx.select().from(decisionLog).orderBy(desc(decisionLog.seq)).limit(1);

    const rec = linkDecision(last ? toRecord(last) : null, {
      taskId: args.taskId,
      agent: args.agent,
      agentCardId: args.agentCardId,
      action: args.action,
      inputHash: hashPayload(args.input),
      outputHash: hashPayload(args.output),
      modelHash: args.modelHash ?? null,
      confidence: args.confidence ?? null,
    });

    await tx.insert(decisionLog).values({ ...rec, at: new Date(rec.at) });
    return rec;
  });
};

export const readChain = async (taskId?: string): Promise<DecisionRecord[]> => {
  const d = db();
  const rows = taskId
    ? await d.select().from(decisionLog).where(eq(decisionLog.taskId, taskId)).orderBy(decisionLog.seq)
    : await d.select().from(decisionLog).orderBy(decisionLog.seq);
  return rows.map(toRecord);
};

/**
 * Verify the WHOLE chain. A per-task slice is not independently verifiable -
 * its records are linked to neighbours that belong to other tasks, so the
 * audit console must check the full ledger and then highlight the slice.
 */
export const verifyLedger = async () => verifyChain(await readChain());

/* ------------------------------------------------------------------ *
 * Status-list index allocation.
 * ------------------------------------------------------------------ */

/**
 * Reserve the next status-list bit position.
 *
 * MUST be called before the credential is signed, and the returned value used
 * verbatim. Deriving an index from a row count - even into a stored column -
 * reproduces the race this exists to close: two concurrent issuances embed the
 * same index, and retiring one then sets the bit the other points at, so a
 * retired credit keeps verifying as live under our own signature.
 *
 * A sequence is atomic and never reuses a value, including across rollbacks.
 * Gaps are fine; collisions are not.
 */
export const nextStatusListIndex = async (): Promise<number> => {
  const result = await db().execute<{ v: string }>(sql`SELECT nextval('credit_status_list_index_seq') AS v`);
  const rows = (result as { rows?: Array<{ v: string }> }).rows ?? (result as unknown as Array<{ v: string }>);
  const value = Number(rows[0]?.v);
  if (!Number.isInteger(value) || value < 0) throw new Error("could not allocate a status list index");
  return value;
};
