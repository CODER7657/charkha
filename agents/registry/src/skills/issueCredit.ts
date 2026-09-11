import type { SkillContext } from "@charkha/a2a";
import type { z } from "zod";
import type { Issuer } from "did-jwt-vc";
import { computeCredit, newId, type CreditRecord, type IssueCreditInput, type IssueCreditOutput } from "@charkha/core";
import { getIssuer } from "../did.ts";
import { signCreditCredential } from "../credential.ts";
import { dbStore, type RegistryStore } from "../store.ts";

/**
 * OWNER: Ayush
 *
 * Compute the net credit and issue it as a W3C Verifiable Credential.
 *
 * The refusals come first and they are the point: an unverified batch never
 * produces a credit, and a batch that has been credited once can never be
 * credited again. See issueCredit.test.ts - that file was written first.
 */
export const makeIssueCredit =
  (store: RegistryStore, issuerFor: () => Issuer) =>
  async (
    input: z.infer<typeof IssueCreditInput>,
    ctx: SkillContext,
  ): Promise<z.infer<typeof IssueCreditOutput>> => {
    const { matchId, evidenceId, verification } = input;

    /* 0. the verification must be about the evidence we are crediting */
    if (verification.evidenceId !== evidenceId)
      throw new Error(
        `verification is for evidence ${verification.evidenceId}, not ${evidenceId} - refusing to issue`,
      );

    /* 1. only an accepted verdict earns a credit */
    if (verification.verdict !== "accepted")
      throw new Error(`refusing to issue: verification verdict is "${verification.verdict}", not "accepted"`);

    /* 2. THE DOUBLE-COUNTING GUARD. One credit per batch of evidence, ever. */
    const existing = await store.findCreditByEvidenceId(evidenceId);
    if (existing)
      throw new Error(
        `evidence ${evidenceId} has already been credited as ${existing.creditId} (${existing.netTonnesCo2e} tCO2e, ${existing.status}) - refusing to issue a second credit`,
      );

    const evidence = await store.findEvidence(evidenceId);
    if (!evidence) throw new Error(`no such evidence: ${evidenceId}`);
    const match = await store.findMatch(matchId);
    if (!match) throw new Error(`no such match: ${matchId}`);
    if (evidence.matchId !== match.matchId)
      throw new Error(`evidence ${evidenceId} belongs to match ${evidence.matchId}, not ${matchId}`);

    /* 3. the carbon math, on the real distance and the verifier's score */
    ctx.progress(`computing net tCO2e over ${match.distanceKm} km of transport`);
    const math = computeCredit({
      feedstockTonnes: match.assignedTonnes,
      biocharTonnes: evidence.batch.outputTonnes,
      transportKm: match.distanceKm,
      qualityScore: verification.charQualityScore,
    });

    /* 4. build and sign the credential */
    const issuer = issuerFor();
    const creditId = newId("crd");
    const issuedAt = new Date().toISOString();
    const credentialId = `urn:charkha:credential:${creditId}`;
    const statusListIndex = (await store.listCredits()).length;

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
    };

    /* 5. store it, then write exactly one decision */
    await store.insertCredit(credit, ctx.taskId);
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

export const issueCredit = makeIssueCredit(dbStore(), getIssuer);
