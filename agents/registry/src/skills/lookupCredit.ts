import type { SkillContext } from "@charkha/a2a";
import type { z } from "zod";
import type { LookupCreditInput, LookupCreditOutput } from "@charkha/core";
import { dbStore, type RegistryStore } from "../store.ts";

/* ------------------------------------------------------------------ *
 * OWNER: Ayush
 *
 * Read one credit. The only skill here that changes nothing.
 *
 * It appends NO decision. The ledger records decisions, and looking
 * something up is not one - rule 5 says exactly once per meaningful
 * decision, and a chain that grows every time somebody asks a question
 * stops being a record of what the system decided.
 *
 * A credit that does not exist comes back as `null` rather than a throw.
 * A throw would reach the caller through the gateway's caller-error
 * classifier as this sentence, in English, on whatever screen they are
 * using - and "no such credit" is an answer a person should get in their
 * own language.
 * ------------------------------------------------------------------ */

export const makeLookupCredit =
  (store: RegistryStore) =>
  async (
    input: z.infer<typeof LookupCreditInput>,
    ctx: SkillContext,
  ): Promise<z.infer<typeof LookupCreditOutput>> => {
    ctx.progress(`looking up ${input.creditId}`);
    const credit = await store.findCreditById(input.creditId);
    return { credit };
  };

export const lookupCredit = makeLookupCredit(dbStore());
