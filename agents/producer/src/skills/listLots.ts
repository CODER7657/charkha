import type { SkillContext } from "@charkha/a2a";
import type { z } from "zod";
import { ListLotsInput, type ListLotsOutput } from "@charkha/core";

/**
 * OWNER: Harsh
 * Read residue_lots, apply filters, return them. Straight query - keep it dull.
 */
export const listLots = async (
  input: z.infer<typeof ListLotsInput>,
  ctx: SkillContext,
): Promise<z.infer<typeof ListLotsOutput>> => {
  void input;
  void ctx;
  return { lots: [] };
};
