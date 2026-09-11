import { linkDecision, verifyChain, hashPayload, type DecisionRecord } from "@charkha/core";
import { desc, eq } from "drizzle-orm";
import { db } from "./index.ts";
import { decisionLog } from "./schema.ts";

/* ------------------------------------------------------------------ *
 * The chain of custody. Every agent calls `appendDecision` exactly once
 * per meaningful decision. Never write to decision_log any other way.
 * ------------------------------------------------------------------ */

const toRecord = (row: typeof decisionLog.$inferSelect): DecisionRecord => ({
  ...row,
  at: row.at.toISOString(),
}) as DecisionRecord;

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
  const [last] = await d.select().from(decisionLog).orderBy(desc(decisionLog.seq)).limit(1);
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
  await d.insert(decisionLog).values({ ...rec, at: new Date(rec.at) });
  return rec;
};

export const readChain = async (taskId?: string): Promise<DecisionRecord[]> => {
  const d = db();
  const rows = taskId
    ? await d.select().from(decisionLog).where(eq(decisionLog.taskId, taskId)).orderBy(decisionLog.seq)
    : await d.select().from(decisionLog).orderBy(decisionLog.seq);
  return rows.map(toRecord);
};

/** Verify the WHOLE chain - a per-task slice is not independently verifiable. */
export const verifyLedger = async () => verifyChain(await readChain());
