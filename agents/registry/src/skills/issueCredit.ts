import type { SkillContext } from "@charkha/a2a";
import type { z } from "zod";
import type { Issuer } from "did-jwt-vc";
import {
  computeCredit,
  hashPayload,
  newId,
  type CreditRecord,
  type IssueCreditInput,
  type IssueCreditOutput,
  type VerifyEvidenceOutput,
} from "@charkha/core";
import { getIssuer } from "../did.ts";
import { signCreditCredential } from "../credential.ts";
import { DuplicateEvidenceError, dbStore, type RegistryStore } from "../store.ts";

/**
 * OWNER: Ayush
 *
 * Compute the net credit and issue it as a W3C Verifiable Credential.
 *
 * The refusals come first and they are the point: an unverified batch never
 * produces a credit, and a batch that has been credited once can never be
 * credited again. See issueCredit.test.ts - that file was written first.
 *
 * THE VERDICT IS READ FROM THE DATABASE, NEVER FROM THE REQUEST. The gateway
 * forwards an unauthenticated body verbatim, so a caller who is believed is a
 * caller who can mint a credential for a batch the verifier never saw. The
 * verifier writes its verdict to `verifications`; that row is the only thing
 * we trust. A missing row is a refusal, never a default.
 */
export const makeIssueCredit =
  (store: RegistryStore, issuerFor: () => Issuer) =>
  async (
    input: z.infer<typeof IssueCreditInput>,
    ctx: SkillContext,
  ): Promise<z.infer<typeof IssueCreditOutput>> => {
    const { matchId, evidenceId } = input;

    /* 0. the verdict, from the verifier's own record. Not from the request. */
    const verification = await store.findVerification(evidenceId);
    if (!verification)
      throw new Error(
        `no verification on record for evidence ${evidenceId} - refusing to issue. The verifier must run first.`,
      );

    /* 1. only an accepted verdict earns a credit */
    if (verification.verdict !== "accepted")
      throw new Error(`refusing to issue: verification verdict is "${verification.verdict}", not "accepted"`);

    /* 2. While the contract still carries a verification, a request that
       disagrees with the stored row is a forgery attempt, not a mismatch to
       shrug at. Refuse it loudly. Nothing above or below reads it, so this is
       a tripwire rather than the control - when the field goes, so does this. */
    const claimed = (input as { verification?: VerifyEvidenceOutput }).verification;
    if (claimed && hashPayload(claimed) !== hashPayload(verification))
      throw new Error(
        `the verification in this request does not match the one on record for evidence ${evidenceId} - refusing to issue`,
      );

    /* 3. THE DOUBLE-COUNTING GUARD. One credit per batch of evidence, ever.
       This read is for a readable error, not for safety - it cannot hold
       against a concurrent request. The unique index on credits.evidence_id
       is the guarantee; alreadyCredited() below reports either outcome the
       same way. */
    const existing = await store.findCreditByEvidenceId(evidenceId);
    if (existing) throw alreadyCredited(existing);

    const evidence = await store.findEvidence(evidenceId);
    if (!evidence) throw new Error(`no such evidence: ${evidenceId}`);
    const match = await store.findMatch(matchId);
    if (!match) throw new Error(`no such match: ${matchId}`);
    if (evidence.matchId !== match.matchId)
      throw new Error(`evidence ${evidenceId} belongs to match ${evidence.matchId}, not ${matchId}`);

    /* 4. the carbon math, on the real distance and the verifier's score */
    ctx.progress(`computing net tCO2e over ${match.distanceKm} km of transport`);
    const math = computeCredit({
      feedstockTonnes: match.assignedTonnes,
      biocharTonnes: evidence.batch.outputTonnes,
      transportKm: match.distanceKm,
      qualityScore: verification.charQualityScore,
    });

    /* 5. build and sign the credential */
    const issuer = issuerFor();
    const creditId = newId("crd");
    const issuedAt = new Date().toISOString();
    const credentialId = `urn:charkha:credential:${creditId}`;
    /* Allocated atomically, before signing. A row count here would let two
       concurrent issuances embed the same index, and retiring one would then
       set the bit the other credential points at. */
    const statusListIndex = await store.allocateStatusListIndex();

    /* The lot's producer holds the resulting credit. No lot, no owner, no
       credit - inventing a holder would make the retirement check meaningless. */
    const holder = await store.findLotProducer(match.lotId);
    if (!holder)
      throw new Error(`no lot ${match.lotId} behind match ${match.matchId} - refusing to issue a credit with no holder`);

    ctx.progress(`signing credential as ${issuer.did}`);
    const credentialJwt = await signCreditCredential(
      {
        credentialId,
        match,
        evidence,
        verification,
        math,
        biocharTonnes: evidence.batch.outputTonnes,
        decisionLogHash: await store.headDecisionHash(),
        statusListIndex,
        issuedAt,
        taskId: ctx.taskId,
      },
      issuer,
    );

    const credit: CreditRecord = {
      creditId,
      matchId: match.matchId,
      evidenceId: evidence.evidenceId,
      netTonnesCo2e: math.netTonnesCo2e,
      breakdown: {
        grossSequestrationTco2e: math.grossSequestrationTco2e,
        transportDebitTco2e: math.transportDebitTco2e,
        processDebitTco2e: math.processDebitTco2e,
      },
      issuedAt,
      status: "issued",
      credentialJwt,
      credentialId,
      issuerDid: issuer.did,
      holder,
      statusListIndex,
    };

    /* 6. store it, then write exactly one decision.
       If a concurrent request inserted first, the database refuses this one
       and we report it exactly as the sequential case does. No decision is
       appended for a credit that does not exist. */
    try {
      await store.insertCredit(credit, ctx.taskId);
    } catch (err) {
      if (err instanceof DuplicateEvidenceError) {
        const winner = await store.findCreditByEvidenceId(evidenceId);
        throw winner ? alreadyCredited(winner) : err;
      }
      throw err;
    }
    await store.appendDecision({
      taskId: ctx.taskId,
      agent: "registry",
      agentCardId: "charkha-registry",
      action: "issueCredit",
      input,
      output: credit,
      modelHash: verification.modelHash,
      confidence: verification.confidence,
    });

    return { credit };
  };

const alreadyCredited = (existing: CreditRecord): Error =>
  new Error(
    `evidence ${existing.evidenceId} has already been credited as ${existing.creditId} (${existing.netTonnesCo2e} tCO2e, ${existing.status}) - refusing to issue a second credit`,
  );

export const issueCredit = makeIssueCredit(dbStore(), getIssuer);
