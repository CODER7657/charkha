import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldEvidence, VerifyEvidenceOutput } from "@charkha/core";
import type { LoadedModel } from "../onnx.ts";
import { CANARY_PREFIX, CLASSES, type ClassScores } from "../protocol.ts";
import {
  MalformedEvidenceError,
  THRESHOLDS,
  makeVerifyEvidence,
  methodologyChecks,
  type MatchFacts,
  type PriorEvidence,
  type VerifierDeps,
} from "./verifyEvidence.ts";

const MODEL_HASH = "a".repeat(64);
const CANARY: ClassScores = { good_char: 0.1, poor_char: 0.2, not_char: 0.7 };
const NOW = new Date("2026-09-11T12:00:00.000Z");
const ctx = { taskId: "task_1", contextId: "ctx_1", progress: () => {} };

const scores = (photo: ClassScores, canary: ClassScores = CANARY) => {
  const out: Record<string, number> = {};
  for (const c of CLASSES) {
    out[c] = photo[c];
    out[`${CANARY_PREFIX}${c}`] = canary[c];
  }
  return out;
};

const evidence = (over: Partial<FieldEvidence> = {}, batch: Partial<FieldEvidence["batch"]> = {}): FieldEvidence => ({
  evidenceId: "ev_1",
  matchId: "match_1",
  at: { lat: 30.9, lon: 75.85 },
  capturedAt: "2026-09-11T11:30:00.000Z",
  imageHash: "b".repeat(64),
  modelHash: MODEL_HASH,
  modelVersion: "0.1.0-baseline",
  clientScores: scores({ good_char: 0.9, poor_char: 0.07, not_char: 0.03 }),
  ...over,
  batch: {
    pyrolysisPeakTempC: 550,
    residenceTimeMin: 90,
    feedstock: "paddy_straw",
    outputTonnes: 2.5,
    hcOrgRatio: 0.4,
    ...batch,
  },
});

const MATCH: MatchFacts = { assignedTonnes: 10, lotFeedstock: "paddy_straw" };

const setup = (opts: { model?: Partial<LoadedModel>; match?: MatchFacts | null; prior?: PriorEvidence | null } = {}) => {
  const run = vi.fn(async (_x: Float32Array) => CANARY);
  const model: LoadedModel = { version: "0.1.0-baseline", hash: MODEL_HASH, loaded: true, run, ...opts.model };
  const deps = {
    model: () => model,
    agentCardId: "http://localhost:4003/.well-known/agent-card.json",
    findMatch: vi.fn(async () => (opts.match === undefined ? MATCH : opts.match)),
    findPrior: vi.fn(async (_id: string): Promise<PriorEvidence | null> => opts.prior ?? null),
    claimEvidence: vi.fn(async (_e: FieldEvidence, _taskId: string) => true),
    appendDecision: vi.fn(async () => ({})),
    saveVerification: vi.fn(async (_v: VerifyEvidenceOutput, _taskId: string) => {}),
    now: () => NOW,
  } satisfies VerifierDeps;
  return { deps, run: model.run === run ? run : (model.run as typeof run), verify: makeVerifyEvidence(deps) };
};

describe("verifyEvidence - happy path", () => {
  it("accepts good char with passing methodology and attests the model", async () => {
    const { run, verify } = setup();
    const out = await verify(evidence(), ctx);

    expect(out.verdict).toBe("accepted");
    expect(out.predictedClass).toBe("good_char");
    expect(out.charQualityScore).toBeCloseTo(0.9);
    expect(out.confidence).toBeCloseTo(0.9);
    expect(out.modelHash).toBe(MODEL_HASH);
    expect(out.methodologyChecks.every((c) => c.passed)).toBe(true);
    expect(out.reasons.some((r) => r.startsWith("canary attested"))).toBe(true);
    // the server really ran the session, on the canary, once
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("appends exactly one decision carrying modelHash and confidence", async () => {
    const { deps, verify } = setup();
    const out = await verify(evidence(), ctx);
    expect(deps.appendDecision).toHaveBeenCalledTimes(1);
    expect(deps.appendDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task_1",
        agent: "verifier",
        action: "verifyEvidence",
        modelHash: MODEL_HASH,
        confidence: out.confidence,
        output: out,
      }),
    );
    expect(deps.saveVerification).toHaveBeenCalledWith(out, "task_1");
  });
});

describe("verifyEvidence - client/server divergence", () => {
  it("lands on needs_review when the browser's canary scores diverge from the server's", async () => {
    const { verify } = setup();
    const tampered = scores({ good_char: 0.9, poor_char: 0.07, not_char: 0.03 }, { good_char: 0.3, poor_char: 0.2, not_char: 0.5 });
    const out = await verify(evidence({ clientScores: tampered }), ctx);
    expect(out.verdict).toBe("needs_review");
    expect(out.reasons.join(" ")).toMatch(/diverge on the canary/);
  });

  it("tolerates runtime noise below the tolerance", async () => {
    const { verify } = setup();
    const eps = THRESHOLDS.canaryTolerance.value / 2;
    const noisy = scores(
      { good_char: 0.9, poor_char: 0.07, not_char: 0.03 },
      { good_char: CANARY.good_char + eps, poor_char: CANARY.poor_char, not_char: CANARY.not_char - eps },
    );
    expect((await verify(evidence({ clientScores: noisy }), ctx)).verdict).toBe("accepted");
  });

  it("lands on needs_review when the client ran a different model file", async () => {
    const { verify } = setup();
    const out = await verify(evidence({ modelHash: "c".repeat(64) }), ctx);
    expect(out.verdict).toBe("needs_review");
    expect(out.reasons.join(" ")).toMatch(/different model file/);
  });

  it("lands on needs_review in stub mode and never pretends to attest", async () => {
    const { verify, run } = setup({ model: { loaded: false, hash: "0".repeat(64) } });
    const out = await verify(evidence(), ctx);
    expect(out.verdict).toBe("needs_review");
    expect(out.reasons.join(" ")).toMatch(/no model loaded/);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("verifyEvidence - classification", () => {
  it("rejects a photo of not-char", async () => {
    const { verify } = setup();
    const out = await verify(evidence({ clientScores: scores({ good_char: 0.02, poor_char: 0.03, not_char: 0.95 }) }), ctx);
    expect(out.verdict).toBe("rejected");
    expect(out.predictedClass).toBe("not_char");
  });

  it("sends poor char to review", async () => {
    const { verify } = setup();
    const out = await verify(evidence({ clientScores: scores({ good_char: 0.1, poor_char: 0.85, not_char: 0.05 }) }), ctx);
    expect(out.verdict).toBe("needs_review");
  });

  it("sends a low-confidence call to review", async () => {
    const { verify } = setup();
    const out = await verify(evidence({ clientScores: scores({ good_char: 0.5, poor_char: 0.3, not_char: 0.2 }) }), ctx);
    expect(out.verdict).toBe("needs_review");
    expect(out.reasons.join(" ")).toMatch(/confidence below/);
  });
});

describe("methodology checks - each passes and fails", () => {
  const byName = (checks: ReturnType<typeof methodologyChecks>, name: string) => checks.find((c) => c.check === name)!;
  const base = evidence().batch;

  it.each([
    ["pyrolysis_peak_temperature", { pyrolysisPeakTempC: 550 }, true],
    ["pyrolysis_peak_temperature", { pyrolysisPeakTempC: 350 }, true],
    ["pyrolysis_peak_temperature", { pyrolysisPeakTempC: 300 }, false],
    ["pyrolysis_peak_temperature", { pyrolysisPeakTempC: 900 }, false],
    ["residence_time", { residenceTimeMin: 30 }, true],
    ["residence_time", { residenceTimeMin: 10 }, false],
    ["hc_org_ratio", { hcOrgRatio: 0.4 }, true],
    ["hc_org_ratio", { hcOrgRatio: null }, true],
    ["hc_org_ratio", { hcOrgRatio: 0.7 }, false],
    ["hc_org_ratio", { hcOrgRatio: 0.95 }, false],
    ["output_vs_matched_lot", { outputTonnes: 4 }, true],
    ["output_vs_matched_lot", { outputTonnes: 4.5 }, false],
    ["feedstock_matches_lot", { feedstock: "paddy_straw" }, true],
    ["feedstock_matches_lot", { feedstock: "wheat_straw" }, false],
  ] as const)("%s with %o -> passed=%s", (name, batch, passed) => {
    expect(byName(methodologyChecks({ ...base, ...batch }, MATCH), name).passed).toBe(passed);
  });

  it("fails reconciliation when the match does not exist", () => {
    const c = byName(methodologyChecks(base, null), "output_vs_matched_lot");
    expect(c.passed).toBe(false);
    expect(c.detail).toMatch(/not found/);
  });

  it("says the H/C ratio is unverified when it is absent", () => {
    expect(byName(methodologyChecks({ ...base, hcOrgRatio: null }, MATCH), "hc_org_ratio").detail).toMatch(/not reported/);
  });

  it("rejects the verdict when any methodology check fails", async () => {
    const { verify } = setup();
    const out = await verify(evidence({}, { residenceTimeMin: 5 }), ctx);
    expect(out.verdict).toBe("rejected");
    expect(out.reasons.join(" ")).toMatch(/methodology failed: residence_time/);
  });

  it("every threshold names its source", () => {
    for (const t of Object.values(THRESHOLDS)) expect(t.source.length).toBeGreaterThan(20);
  });
});

describe("verifyEvidence - malformed input never reaches the ONNX session", () => {
  const malformed: Array<[string, FieldEvidence]> = [
    ["negative tonnes", evidence({}, { outputTonnes: -3 })],
    ["absurd temperature", evidence({}, { pyrolysisPeakTempC: 25_000 })],
    ["NaN temperature", evidence({}, { pyrolysisPeakTempC: Number.NaN })],
    ["negative residence", evidence({}, { residenceTimeMin: -1 })],
    ["absurd H/C", evidence({}, { hcOrgRatio: 12 })],
    ["imageHash not hex", evidence({ imageHash: "z".repeat(64) })],
    ["modelHash uppercase", evidence({ modelHash: "A".repeat(64) })],
    ["capturedAt in the future", evidence({ capturedAt: "2026-09-12T12:00:00.000Z" })],
    ["capturedAt ancient", evidence({ capturedAt: "2025-01-01T00:00:00.000Z" })],
    ["score out of [0,1]", evidence({ clientScores: scores({ good_char: 1.4, poor_char: -0.2, not_char: -0.2 }) })],
    ["scores do not sum to 1", evidence({ clientScores: scores({ good_char: 0.5, poor_char: 0.1, not_char: 0.1 }) })],
    ["canary keys missing", evidence({ clientScores: { good_char: 0.9, poor_char: 0.07, not_char: 0.03 } })],
    ["smuggled extra key", evidence({ clientScores: { ...scores({ good_char: 0.9, poor_char: 0.07, not_char: 0.03 }), pixel0: 0.5 } })],
    ["id with path characters", evidence({ evidenceId: "../../etc/passwd" })],
  ];

  it.each(malformed)("refuses %s", async (_name, bad) => {
    const { deps, run, verify } = setup();
    await expect(verify(bad, ctx)).rejects.toBeInstanceOf(MalformedEvidenceError);
    expect(run).not.toHaveBeenCalled();
    expect(deps.claimEvidence).not.toHaveBeenCalled();
    expect(deps.appendDecision).not.toHaveBeenCalled();
    expect(deps.saveVerification).not.toHaveBeenCalled();
  });
});

describe("verifyEvidence - offline retries are idempotent", () => {
  let recorded: VerifyEvidenceOutput;
  beforeEach(async () => {
    recorded = await setup().verify(evidence(), ctx);
  });

  it("replays the recorded verdict for a retried submission without a second ledger entry", async () => {
    // Same evidence, with the timestamp re-serialised the way Postgres returns it.
    const stored = { ...evidence(), capturedAt: new Date(evidence().capturedAt).toISOString() };
    const { deps, run, verify } = setup({ prior: { evidence: stored, verification: recorded } });
    const out = await verify(evidence(), ctx);
    expect(out).toEqual(recorded);
    expect(run).not.toHaveBeenCalled();
    expect(deps.appendDecision).not.toHaveBeenCalled();
  });

  it("refuses to reuse an evidenceId for different content", async () => {
    const { deps, verify } = setup({ prior: { evidence: evidence({}, { outputTonnes: 1 }), verification: recorded } });
    await expect(verify(evidence(), ctx)).rejects.toThrow(/different content/);
    expect(deps.appendDecision).not.toHaveBeenCalled();
  });

  it("finishes a claimed-but-unverified submission", async () => {
    const { deps, verify } = setup({ prior: { evidence: evidence(), verification: null } });
    expect((await verify(evidence(), ctx)).verdict).toBe("accepted");
    expect(deps.claimEvidence).not.toHaveBeenCalled();
    expect(deps.appendDecision).toHaveBeenCalledTimes(1);
  });

  it("concurrent duplicates wait for the first verification instead of re-verifying a claimed row", async () => {
    // A store with real async gaps, so request 2 can observe request 1's
    // claimed-but-unverified row - the interleaving that double-wrote the ledger.
    const rows = new Map<string, PriorEvidence>();
    const gap = () => new Promise((r) => setTimeout(r, 5));
    const { deps, verify } = setup();
    deps.findPrior.mockImplementation(async (id: string) => {
      await gap();
      return rows.get(id) ?? null;
    });
    deps.claimEvidence.mockImplementation(async (e: FieldEvidence) => {
      await gap();
      if (rows.has(e.evidenceId)) return false;
      rows.set(e.evidenceId, { evidence: e, verification: null });
      return true;
    });
    deps.saveVerification.mockImplementation(async (v: VerifyEvidenceOutput) => {
      await gap();
      rows.set(v.evidenceId, { ...rows.get(v.evidenceId)!, verification: v });
    });
    deps.appendDecision.mockImplementation(async () => {
      await gap();
      return {};
    });

    const results = await Promise.all(Array.from({ length: 5 }, () => verify(evidence(), ctx)));
    expect(deps.appendDecision).toHaveBeenCalledTimes(1);
    for (const r of results) expect(r).toEqual(results[0]);
  });

  it("refuses when another process already claimed the evidence", async () => {
    const { deps, verify } = setup();
    deps.claimEvidence.mockResolvedValueOnce(false);
    await expect(verify(evidence(), ctx)).rejects.toThrow(/another verifier process/);
    expect(deps.appendDecision).not.toHaveBeenCalled();
  });
});
