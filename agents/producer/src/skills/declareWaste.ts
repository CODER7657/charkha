import type { SkillContext } from "@charkha/a2a";
import type { z } from "zod";
import type { DeclareWasteInput, DeclareWasteOutput } from "@charkha/core";
import { newId } from "@charkha/core";
import { db, schema } from "@charkha/db";
import { appendDecision } from "@charkha/db/ledger";
import { AGENT_CARD_ID } from "../card.ts";
import { toDeclaredLot } from "../declare.ts";

/**
 * OWNER: Harsh
 *
 * The second supply path: somebody tells us they have waste.
 *
 * Everything that decides what the lot looks like is in `toDeclaredLot` next
 * door and is pure; this file is I/O. One insert, one decision record.
 *
 * Every refusal this skill has is a schema refusal, enforced at the A2A
 * boundary before we are called - an anonymous declarer, an impossible
 * tonnage, a feedstock outside the closed set. There is deliberately no
 * second check here: a guard written twice is a guard that drifts, and the
 * boundary one cannot be bypassed. See skills/refusals.test.ts, which proves
 * each of them still classifies as a caller error and so reports as 400.
 */
export const declareWaste = async (
  input: z.infer<typeof DeclareWasteInput>,
  ctx: SkillContext,
): Promise<z.infer<typeof DeclareWasteOutput>> => {
  const lot = toDeclaredLot(input, { lotId: newId("lot"), now: new Date() });

  ctx.progress(
    `${input.declaredBy} declares ${lot.tonnes} t of ${lot.feedstock}` +
      `${lot.district ? ` in ${lot.district}` : ""}`,
  );

  /* No onConflictDoNothing here, and that is not an oversight. The ingest
     path dedupes because FIRMS hands us the same overpass twice and the lot
     id is derived from it; a declaration has no natural key, so its id is
     fresh and a conflict would mean a UUID collision. Swallowing that would
     return a lot that was never written. */
  const [row] = await db()
    .insert(schema.residueLots)
    .values({
      lotId: lot.lotId,
      producerId: lot.producerId,
      lat: lot.at.lat,
      lon: lot.at.lon,
      district: lot.district,
      feedstock: lot.feedstock,
      tonnes: lot.tonnes,
      availableFrom: new Date(lot.availableFrom),
      sourceDetectionId: lot.sourceDetectionId,
      status: lot.status,
      origin: lot.origin ?? "declared",
    })
    .returning({ id: schema.residueLots.lotId });

  // The count comes from RETURNING, like ingest: a decision record claiming a
  // lot that was not written is worse than no record at all.
  if (!row) throw new Error("the declaration was not recorded - no lot row came back");

  const output = { lot };

  /* Exactly one decision per declaration. Rule 5.
  
     `input` goes in unmodified, which is also how the declarer's `note`
     reaches the ledger: it is part of the contract, so it is part of
     inputHash, so changing it after the fact breaks the chain.
  
     Being honest about the limit of that - an auditor can VERIFY a note they
     already hold, but cannot READ one they do not. decision_log stores
     hashes, and residue_lots has no note column, so there is nowhere for the
     sentence itself to live today. Raised on #63; one column and one line
     here closes it. */
  const decision = await appendDecision({
    taskId: ctx.taskId,
    agent: "producer",
    agentCardId: AGENT_CARD_ID,
    action: "declareWaste",
    input,
    output,
  });

  ctx.progress(`lot ${lot.lotId} recorded as declared, ledger seq ${decision.seq}`);

  return output;
};
