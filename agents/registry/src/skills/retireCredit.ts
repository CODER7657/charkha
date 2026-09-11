import type { SkillContext } from "@charkha/a2a";
import type { z } from "zod";
import { RetireCreditInput, type RetireCreditOutput } from "@charkha/core";

/**
 * OWNER: Ayush
 *
 * Retire a credit. Retirement is terminal and must be idempotent: retiring an
 * already-retired credit returns the same record, it does not error and it
 * does not append a second decision.
 *
 * Expose the retirement state as a status list the credential points at, so a
 * holder can check "is this still live" without asking our API for permission.
 * That is what stops double-selling, and it is the answer to "why no
 * blockchain" - portable, offline-checkable proof without consensus.
 */
export const retireCredit = async (
  input: z.infer<typeof RetireCreditInput>,
  ctx: SkillContext,
): Promise<z.infer<typeof RetireCreditOutput>> => {
  ctx.progress("TODO(ayush): flip status to retired + update status list");
  void input;
  throw new Error("retireCredit not implemented");
};
