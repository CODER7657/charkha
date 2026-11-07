import { createVerifiableCredentialJwt, type Issuer, type JwtCredentialPayload } from "did-jwt-vc";
import type { CreditMath, FieldEvidence, Match, VerifyEvidenceOutput } from "@charkha/core";
import { FACTORS } from "@charkha/core";
import { statusListEntry } from "./statusList.ts";

/* ------------------------------------------------------------------ *
 * The credential.
 *
 * credentialSubject mirrors the three evidence classes a real biochar
 * methodology asks for - production, application, chain of custody - plus
 * the carbon math with the factors it used, and the model that made the
 * call. Anyone holding this JWT can reconstruct our arithmetic.
 *
 * NOTE on @context: did-jwt-vc (the JWT encoding of a VC) requires the v1
 * context. The field names are the ones VC Data Model v2 uses, so moving to
 * the v2 context later is a one-line change.
 * ------------------------------------------------------------------ */

export type CreditCredentialArgs = {
  credentialId: string;
  match: Match;
  evidence: FieldEvidence;
  verification: VerifyEvidenceOutput;
  math: CreditMath;
  biocharTonnes: number;
  decisionLogHash: string;
  statusListIndex: number;
  issuedAt: string;
  taskId: string;
};

export const creditCredentialPayload = (args: CreditCredentialArgs): JwtCredentialPayload => ({
  sub: `urn:charkha:lot:${args.match.lotId}`,
  jti: args.credentialId,
  nbf: Math.floor(new Date(args.issuedAt).getTime() / 1000),
  vc: {
    "@context": ["https://www.w3.org/2018/credentials/v1"],
    type: ["VerifiableCredential", "CarbonRemovalCredential"],
    credentialStatus: statusListEntry(args.statusListIndex),
    credentialSubject: {
      id: `urn:charkha:lot:${args.match.lotId}`,

      /* 1. production evidence - what was made, and under what conditions */
      productionEvidence: {
        batchId: args.evidence.evidenceId,
        unitId: args.match.unitId,
        feedstock: args.evidence.batch.feedstock,
        pyrolysisPeakTempC: args.evidence.batch.pyrolysisPeakTempC,
        residenceTimeMin: args.evidence.batch.residenceTimeMin,
        hcOrgRatio: args.evidence.batch.hcOrgRatio,
        biocharTonnes: args.biocharTonnes,
        charQualityScore: args.verification.charQualityScore,
      },

      /* 2. application evidence - where it went, and how much */
      applicationEvidence: {
        gps: args.evidence.at,
        capturedAt: args.evidence.capturedAt,
        imageHash: args.evidence.imageHash,
        lotId: args.match.lotId,
        feedstockTonnes: args.match.assignedTonnes,
        transportKm: args.match.distanceKm,
      },

      /* 3. chain of custody - the ledger head at the moment of issuance */
      chainOfCustody: {
        taskId: args.taskId,
        matchId: args.match.matchId,
        evidenceId: args.evidence.evidenceId,
        decisionLogHash: args.decisionLogHash,
      },

      /* the model that made the call */
      model: {
        modelHash: args.verification.modelHash,
        modelVersion: args.verification.modelVersion,
        predictedClass: args.verification.predictedClass,
        confidence: args.verification.confidence,
      },

      /* the arithmetic, with the factor behind every term */
      carbonAccounting: {
        netTonnesCo2e: args.math.netTonnesCo2e,
        grossSequestrationTco2e: args.math.grossSequestrationTco2e,
        transportDebitTco2e: args.math.transportDebitTco2e,
        processDebitTco2e: args.math.processDebitTco2e,
        factors: FACTORS,
      },

      methodologyChecks: args.verification.methodologyChecks,
    },
  },
});

export const signCreditCredential = async (args: CreditCredentialArgs, issuer: Issuer): Promise<string> =>
  createVerifiableCredentialJwt(creditCredentialPayload(args), issuer);
