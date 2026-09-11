import type { SkillContext } from "@charkha/a2a";
import type { z } from "zod";
import type { RetireCreditInput, RetireCreditOutput } from "@charkha/core";
import { dbStore, type RegistryStore } from "../store.ts";

/**
 * OWNER: Ayush
 *
 * Retire a credit. Terminal and idempotent: retiring an already-retired
 * credit returns the same record, does not error, and does NOT append a
 * second decision - the ledger must not claim a retirement happened twice.
 *
 * The retirement itself is published through the status list the credential
 * points at (see statusList.ts), so a holder can check "is this still live"
 * without asking us.
 */
export const makeRetireCredit =
  (store: RegistryStore) =>
  async (
    input: z.infer<typeof RetireCreditInput>,
    ctx: SkillContext,
  ): Promise<z.infer<typeof RetireCreditOutput>> => {
    const existing = await store.findCreditById(input.creditId);
    if (!existing) throw new Error(`no such credit: ${input.creditId}`);

    /* Already retired: hand back the same record and touch nothing. */
    if (existing.status === "retired") {
      ctx.progress(`${input.creditId} is already retired - nothing to do`);
      return { credit: existing };
    }

    ctx.progress(`retiring ${input.creditId} for ${input.retiredBy}`);
    const credit = await store.markRetired(input.creditId);

    await store.appendDecision({
      taskId: ctx.taskId,
      agent: "registry",
      agentCardId: "charkha-registry",
      action: "retireCredit",
      input,
      output: credit,
    });

    return { credit };
  };

export const retireCredit = makeRetireCredit(dbStore());
