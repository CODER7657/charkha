import { readChain } from "@charkha/db/ledger";
import { verifyChain, type TraceBundle } from "@charkha/core";
import { db, schema, eq } from "@charkha/db";

/**
 * OWNER: core (Pavan)
 * Assemble evidence -> decision -> credential for one A2A task id.
 * This is slide 4 of the pitch. It must never 500.
 */
export const buildTrace = async (taskId: string): Promise<TraceBundle | null> => {
  const d = db();
  const chain = await readChain(taskId);
  if (chain.length === 0) return null;

  const full = await readChain();
  const [match] = await d.select().from(schema.matches).where(eq(schema.matches.taskId, taskId)).limit(1);
  const [credit] = await d.select().from(schema.credits).where(eq(schema.credits.taskId, taskId)).limit(1);

  return {
    taskId,
    lot: null,
    match: (match as never) ?? null,
    evidence: null,
    verification: null,
    credit: (credit as never) ?? null,
    chain,
    chainValid: verifyChain(full).valid,
  };
};
