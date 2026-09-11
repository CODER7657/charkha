import type { SkillContext } from "@charkha/a2a";
import type { appendDecision } from "@charkha/db/ledger";
import type { z } from "zod";
import { canonicalJson, VerifyEvidenceInput, type FieldEvidence, type VerifyEvidenceOutput } from "@charkha/core";
import type { LoadedModel } from "../onnx.ts";
import {
  CANARY_PREFIX,
  CLASSES,
  canaryTensor,
  topClass,
  type CharClass,
  type ClassScores,
} from "../protocol.ts";

/* ------------------------------------------------------------------ *
 * OWNER: Hem
 *
 * Turn field evidence into an auditable verdict. Two independent checks,
 * both always present in the output:
 *
 *  1. MODEL - the photo was scored on the device (it never leaves it). The
 *     server attests that score by re-running the model on the hash-seeded
 *     canary (see protocol.ts) and comparing with the browser's canary
 *     scores. Divergence, a different model hash, or no model -> needs_review.
 *
 *  2. METHODOLOGY - deterministic rules over `batch`, each a
 *     { check, passed, detail } entry. Any failure -> rejected.
 *
 * Every threshold carries a `source`, the way @charkha/core/carbon.ts does.
 * ------------------------------------------------------------------ */

export type Threshold = { value: number; unit: string; source: string };

export const THRESHOLDS = {
  /** Lower edge of the pyrolysis window. */
  peakTempMinC: {
    value: 350,
    unit: "°C",
    source: "European Biochar Certificate (EBC) guidelines: pyrolysis temperature between 350 °C and 1000 °C",
  },
  /** Upper edge of a SLOW pyrolysis window - hotter runs are gasification territory. */
  peakTempMaxC: {
    value: 750,
    unit: "°C",
    source:
      "Slow pyrolysis for biochar is typically run at ~400-700 °C (Lehmann & Joseph, Biochar for Environmental Management, 2nd ed., 2015); +50 °C Charkha margin for kiln thermocouple placement",
  },
  /** Minimum hold time at temperature. */
  residenceTimeMinMin: {
    value: 30,
    unit: "min",
    source:
      "Charkha engineering assumption: slow pyrolysis is characterised by solids residence of minutes to hours (Bridgwater 2012, Biomass & Bioenergy 38:68-94); 30 min is a conservative floor for batch kilns",
  },
  /** Permanence: molar H/C_org ratio must be below this. */
  hcOrgMax: {
    value: 0.7,
    unit: "mol/mol",
    source: "EBC guidelines and IBI Biochar Standards: molar H/C_org < 0.7; Puro.earth biochar methodology applies the same cut-off",
  },
  /** Most biochar a tonne of dry feedstock can plausibly yield. */
  maxBiocharYield: {
    value: 0.4,
    unit: "t biochar / t feedstock",
    source:
      "Slow pyrolysis char yield ~35% of dry feedstock (Bridgwater 2012, Table 1); +5 points measurement slack. Expected yield used for credits is FACTORS.biocharYieldFromFeedstock",
  },
  /** Browser vs server canary scores may differ by at most this per class. */
  canaryTolerance: {
    value: 1e-3,
    unit: "probability",
    source:
      "Charkha: parity.test.ts shows onnxruntime-node vs onnxruntime-web (wasm) agree to ~1e-6; WebGPU kernels drift more. 1e-3 is far above runtime noise and far below what a different model produces",
  },
  /** Below this top-class probability a human looks at the photo. */
  minConfidence: {
    value: 0.6,
    unit: "probability",
    source: "Charkha engineering assumption, tune once the fine-tuned model has a validation set",
  },
} as const satisfies Record<string, Threshold>;

/**
 * Bounds that make a payload MALFORMED rather than a failed methodology
 * check. These are "cannot be a real reading", not "bad batch".
 */
const BOUNDS = {
  tempC: [-50, 1600],
  residenceMin: [0, 7 * 24 * 60],
  hcOrg: [0, 3],
  outputTonnes: [0, 10_000],
  /** Offline queue may hold evidence for a while, but not forever. */
  maxAgeMs: 30 * 24 * 3600_000,
  maxClockSkewMs: 5 * 60_000,
  scoreSumTolerance: 0.01,
} as const;

const HEX64 = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;

export class MalformedEvidenceError extends Error {
  constructor(readonly problems: string[]) {
    super(`malformed evidence, refused before inference: ${problems.join("; ")}`);
    this.name = "MalformedEvidenceError";
  }
}

const inRange = (n: number, [lo, hi]: readonly [number, number]) => Number.isFinite(n) && n >= lo && n <= hi;

/** Everything that must hold before a payload is allowed near the ONNX session. */
export const findProblems = (e: FieldEvidence, now: Date): string[] => {
  const p: string[] = [];
  if (!ID.test(e.evidenceId)) p.push("evidenceId must be 1-128 chars of [A-Za-z0-9_-]");
  if (!ID.test(e.matchId)) p.push("matchId must be 1-128 chars of [A-Za-z0-9_-]");
  if (!HEX64.test(e.imageHash)) p.push("imageHash must be 64 lowercase hex chars");
  if (!HEX64.test(e.modelHash)) p.push("modelHash must be 64 lowercase hex chars");
  if (e.modelVersion.length === 0 || e.modelVersion.length > 64) p.push("modelVersion must be 1-64 chars");

  const captured = Date.parse(e.capturedAt);
  if (captured - now.getTime() > BOUNDS.maxClockSkewMs) p.push("capturedAt is in the future");
  if (now.getTime() - captured > BOUNDS.maxAgeMs) p.push("capturedAt is more than 30 days old");

  const b = e.batch;
  if (!inRange(b.pyrolysisPeakTempC, BOUNDS.tempC)) p.push(`pyrolysisPeakTempC ${b.pyrolysisPeakTempC} is not a physical kiln reading`);
  if (!inRange(b.residenceTimeMin, BOUNDS.residenceMin)) p.push(`residenceTimeMin ${b.residenceTimeMin} is out of bounds`);
  if (!inRange(b.outputTonnes, BOUNDS.outputTonnes) || b.outputTonnes <= 0) p.push(`outputTonnes ${b.outputTonnes} is out of bounds`);
  if (b.hcOrgRatio !== null && !inRange(b.hcOrgRatio, BOUNDS.hcOrg)) p.push(`hcOrgRatio ${b.hcOrgRatio} is out of bounds`);

  // clientScores: exactly the photo classes plus their canary twins.
  const expected = new Set(CLASSES.flatMap((c) => [c, `${CANARY_PREFIX}${c}`]));
  const keys = Object.keys(e.clientScores);
  const extra = keys.filter((k) => !expected.has(k));
  const missing = [...expected].filter((k) => !(k in e.clientScores));
  if (extra.length) p.push(`clientScores has unexpected keys: ${extra.join(", ")}`);
  if (missing.length) p.push(`clientScores is missing: ${missing.join(", ")}`);
  if (!extra.length && !missing.length) {
    for (const [k, v] of Object.entries(e.clientScores)) {
      if (!inRange(v, [0, 1])) p.push(`clientScores.${k} must be a probability in [0, 1]`);
    }
    for (const prefix of ["", CANARY_PREFIX]) {
      const sum = CLASSES.reduce((s, c) => s + (e.clientScores[`${prefix}${c}`] ?? 0), 0);
      if (Math.abs(sum - 1) > BOUNDS.scoreSumTolerance) p.push(`${prefix || "photo "}scores sum to ${sum.toFixed(4)}, not 1`);
    }
  }
  return p;
};

const pick = (scores: Record<string, number>, prefix = ""): ClassScores =>
  Object.fromEntries(CLASSES.map((c) => [c, scores[`${prefix}${c}`]!])) as ClassScores;

export type MethodologyCheck = VerifyEvidenceOutput["methodologyChecks"][number];
export type MatchFacts = { assignedTonnes: number; lotFeedstock: string | null };

/** Deterministic, model-free rules over the batch parameters. */
export const methodologyChecks = (batch: FieldEvidence["batch"], match: MatchFacts | null): MethodologyCheck[] => {
  const T = THRESHOLDS;
  const checks: MethodologyCheck[] = [];
  const t = batch.pyrolysisPeakTempC;
  checks.push({
    check: "pyrolysis_peak_temperature",
    passed: t >= T.peakTempMinC.value && t <= T.peakTempMaxC.value,
    detail: `${t} °C, slow-pyrolysis window ${T.peakTempMinC.value}-${T.peakTempMaxC.value} °C`,
  });
  checks.push({
    check: "residence_time",
    passed: batch.residenceTimeMin >= T.residenceTimeMinMin.value,
    detail: `${batch.residenceTimeMin} min, minimum ${T.residenceTimeMinMin.value} min`,
  });
  checks.push(
    batch.hcOrgRatio === null
      ? { check: "hc_org_ratio", passed: true, detail: "not reported - permanence ratio unverified, lab result pending" }
      : {
          check: "hc_org_ratio",
          passed: batch.hcOrgRatio < T.hcOrgMax.value,
          detail: `H/C_org ${batch.hcOrgRatio}, must be below ${T.hcOrgMax.value}`,
        },
  );
  if (!match) {
    checks.push({ check: "output_vs_matched_lot", passed: false, detail: "matchId not found - no lot to reconcile output against" });
  } else {
    const max = match.assignedTonnes * T.maxBiocharYield.value;
    checks.push({
      check: "output_vs_matched_lot",
      passed: batch.outputTonnes <= max,
      detail: `${batch.outputTonnes} t biochar from ${match.assignedTonnes} t feedstock, at most ${round(max)} t (${T.maxBiocharYield.value * 100}% yield)`,
    });
    if (match.lotFeedstock) {
      checks.push({
        check: "feedstock_matches_lot",
        passed: batch.feedstock === match.lotFeedstock,
        detail: `batch ${batch.feedstock}, lot ${match.lotFeedstock}`,
      });
    }
  }
  return checks;
};

const round = (n: number, dp = 3) => Math.round(n * 10 ** dp) / 10 ** dp;

/* ------------------------------------------------------------------ */

export type PriorEvidence = { evidence: FieldEvidence; verification: VerifyEvidenceOutput | null };

export type VerifierDeps = {
  model: () => LoadedModel;
  agentCardId: string;
  findMatch: (matchId: string) => Promise<MatchFacts | null>;
  findPrior: (evidenceId: string) => Promise<PriorEvidence | null>;
  /** Insert the evidence row. false if another request claimed it first. */
  claimEvidence: (evidence: FieldEvidence, taskId: string) => Promise<boolean>;
  appendDecision: (args: Parameters<typeof appendDecision>[0]) => Promise<unknown>;
  saveVerification: (output: VerifyEvidenceOutput, taskId: string) => Promise<void>;
  now: () => Date;
};

/** Same evidence, modulo how the database round-trips a timestamp. */
export const sameEvidence = (a: FieldEvidence, b: FieldEvidence): boolean =>
  canonicalJson({ ...a, capturedAt: Date.parse(a.capturedAt) }) ===
  canonicalJson({ ...b, capturedAt: Date.parse(b.capturedAt) });

export const makeVerifyEvidence =
  (deps: VerifierDeps) =>
  async (input: z.infer<typeof VerifyEvidenceInput>, ctx: SkillContext): Promise<VerifyEvidenceOutput> => {
    // 1. Refuse malformed input. Nothing below this line sees a bad payload.
    const problems = findProblems(input, deps.now());
    if (problems.length) throw new MalformedEvidenceError(problems);

    // 2. Idempotency: the offline queue retries, so the same evidence can
    //    arrive twice. Replay the stored verdict; never append a second decision.
    const prior = await deps.findPrior(input.evidenceId);
    if (prior) {
      if (!sameEvidence(prior.evidence, input)) {
        throw new Error(`evidenceId ${input.evidenceId} was already submitted with different content - refused`);
      }
      if (prior.verification) {
        ctx.progress("evidence already verified - returning the recorded verdict");
        return prior.verification;
      }
      // Claimed earlier but never finished (crash mid-verify): finish it now.
    } else if (!(await deps.claimEvidence(input, ctx.taskId))) {
      throw new Error(`evidenceId ${input.evidenceId} is being verified by a concurrent request - retry shortly`);
    }

    const reasons: string[] = [];
    let needsReview = false;
    let rejected = false;

    // 3. Model attestation.
    const model = deps.model();
    const photo = pick(input.clientScores);
    const top = topClass(photo);

    if (!model.loaded) {
      needsReview = true;
      reasons.push("server has no model loaded - on-device score cannot be attested");
    } else {
      if (input.modelHash !== model.hash) {
        needsReview = true;
        reasons.push(`client ran model ${input.modelHash.slice(0, 12)}…, server runs ${model.hash.slice(0, 12)}… - different model file`);
      }
      ctx.progress("running canary through onnxruntime-node");
      const server = await model.run(canaryTensor(input.imageHash));
      const client = pick(input.clientScores, CANARY_PREFIX);
      const drift = Math.max(...CLASSES.map((c) => Math.abs(server[c] - client[c])));
      if (drift > THRESHOLDS.canaryTolerance.value) {
        needsReview = true;
        reasons.push(
          `client and server scores diverge on the canary: max drift ${drift.toExponential(2)} > ${THRESHOLDS.canaryTolerance.value} - on-device scores not trusted`,
        );
      } else {
        reasons.push(`canary attested: browser and server agree within ${drift.toExponential(2)}`);
      }
    }

    reasons.push(`on-device classification: ${top.cls} (${(top.p * 100).toFixed(1)}%)`);
    const verdictByClass: Record<CharClass, "ok" | "review" | "reject"> = {
      good_char: "ok",
      poor_char: "review",
      not_char: "reject",
    };
    if (verdictByClass[top.cls] === "reject") {
      rejected = true;
      reasons.push("photo is not biochar");
    } else if (verdictByClass[top.cls] === "review") {
      needsReview = true;
      reasons.push("photo looks under-pyrolysed or ashy");
    }
    if (top.p < THRESHOLDS.minConfidence.value) {
      needsReview = true;
      reasons.push(`confidence below ${THRESHOLDS.minConfidence.value}`);
    }

    // 4. Methodology.
    ctx.progress("running methodology checks");
    const checks = methodologyChecks(input.batch, await deps.findMatch(input.matchId));
    const failed = checks.filter((c) => !c.passed);
    if (failed.length) {
      rejected = true;
      reasons.push(`methodology failed: ${failed.map((c) => c.check).join(", ")}`);
    }

    const output: VerifyEvidenceOutput = {
      evidenceId: input.evidenceId,
      verdict: rejected ? "rejected" : needsReview ? "needs_review" : "accepted",
      charQualityScore: photo.good_char,
      predictedClass: top.cls,
      confidence: top.p,
      modelHash: model.hash,
      modelVersion: model.version,
      reasons,
      methodologyChecks: checks,
    };

    // 5. Exactly one decision per verification, then persist the verdict.
    await deps.appendDecision({
      taskId: ctx.taskId,
      agent: "verifier",
      agentCardId: deps.agentCardId,
      action: "verifyEvidence",
      input,
      output,
      modelHash: model.hash,
      confidence: top.p,
    });
    await deps.saveVerification(output, ctx.taskId);
    return output;
  };
