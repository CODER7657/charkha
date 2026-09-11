import type { SkillContext } from "@charkha/a2a";
import type { z } from "zod";
import { IssueCreditInput, type IssueCreditOutput } from "@charkha/core";

/**
 * OWNER: Ayush
 *
 * Compute the net credit and issue it as a W3C Verifiable Credential.
 *
 * STEPS
 *  1. refuse to issue unless verification.verdict === "accepted" - an
 *     unverified batch must never produce a credit, and you should have a
 *     test that proves it
 *  2. refuse to issue a SECOND credit for the same evidenceId - this is the
 *     double-counting guard and it is the single most important test in the
 *     repo. Write it first.
 *  3. computeCredit() from @charkha/core, feeding in the real transport km
 *     off the match and the verifier's charQualityScore
 *  4. build the VC. Model credentialSubject on the three evidence classes the
 *     real biochar methodology requires: production evidence (pyrolysis
 *     params), application evidence (GPS + quantity), and the chain-of-custody
 *     pointer (the decision-log hash at issuance time). Include modelHash and
 *     modelVersion - the credential should say which model made the call.
 *  5. sign with the did:key issuer, store the JWT, append one decision
 *
 * Replace the PLACEHOLDER sources in @charkha/core/carbon.ts with real cited
 * figures as part of this issue. Do not leave "PLACEHOLDER" in the repo.
 */
export const issueCredit = async (
  input: z.infer<typeof IssueCreditInput>,
  ctx: SkillContext,
): Promise<z.infer<typeof IssueCreditOutput>> => {
  ctx.progress("TODO(ayush): compute net tCO2e and sign the credential");
  void input;
  throw new Error("issueCredit not implemented");
};
