import type { SkillContext } from "@charkha/a2a";
import type { z } from "zod";
import { VerifyEvidenceInput, type VerifyEvidenceOutput } from "@charkha/core";

/**
 * OWNER: Hem
 *
 * Turn field evidence into an auditable verdict.
 *
 * TWO INDEPENDENT CHECKS, both must appear in the output:
 *
 * 1. MODEL SCORE - run the ONNX model, get charQualityScore + predictedClass
 *    + confidence. Compare against the browser-side `clientScores` that came
 *    with the evidence: if they diverge by more than a small tolerance, the
 *    verdict is "needs_review" and you say so in `reasons`. That divergence
 *    check is a genuinely good demo beat - do not drop it.
 *
 * 2. METHODOLOGY CHECKS - deterministic rules over `batch`, each producing a
 *    { check, passed, detail } entry. At minimum:
 *      - pyrolysisPeakTempC within a plausible slow-pyrolysis window
 *      - residenceTimeMin above the minimum for that window
 *      - hcOrgRatio below the permanence threshold when present
 *      - outputTonnes plausible against the matched lot's tonnes
 *    Put the real thresholds and their source in a constants block at the top
 *    of this file, the way @charkha/core/carbon.ts does it.
 *
 * REJECT MALFORMED INPUT BEFORE INFERENCE. The schema already ran, but bounds
 * checks (negative tonnes, absurd temperatures) belong here. A bad payload
 * must never reach the ONNX session.
 *
 * Append one decision with modelHash and confidence populated.
 */
export const verifyEvidence = async (
  input: z.infer<typeof VerifyEvidenceInput>,
  ctx: SkillContext,
): Promise<VerifyEvidenceOutput> => {
  ctx.progress("TODO(hem): run ONNX + methodology checks");
  return {
    evidenceId: input.evidenceId,
    verdict: "needs_review",
    charQualityScore: 0,
    predictedClass: "unknown",
    confidence: 0,
    modelHash: "0".repeat(64),
    modelVersion: "0.0.0-stub",
    reasons: ["verifier not implemented yet"],
    methodologyChecks: [],
  };
};
