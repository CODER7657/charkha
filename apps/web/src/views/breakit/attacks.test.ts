import { describe, it, expect } from "vitest";
import type { DecisionRecord, FieldEvidence, TraceBundle } from "@charkha/core";
import { linkDecision, hashPayload } from "@charkha/core";
import {
  ATTACKS,
  duplicatePhotoPayload,
  forgedVerdictPayload,
  judgeHttp,
  judgeTamper,
  pickTargets,
  tamperAt,
  verifyHere,
  type HttpResult,
} from "./attacks.ts";

/* ------------------------------------------------------------------ *
 * The attempts themselves hit a live API, so what is worth testing is the
 * judgement: given what came back, did the guard hold?
 *
 * The branch that matters most is the one that will almost never fire. An
 * attack that SUCCEEDS must render as a failure, loudly. A screen that painted
 * that green would be worse than no screen at all, and in real life nothing
 * would ever exercise the branch that decides - so it is exercised here.
 * ------------------------------------------------------------------ */

const ok = (status: number, body = "{}"): HttpResult => ({ ok: true, status, body });

describe("an attempt that succeeds is a failure, and says so", () => {
  /* THE GUARANTEE. Feed it a 200 and the row must read as broken. */
  it("calls a 2xx broken, never passed", () => {
    for (const status of [200, 201, 202, 204, 299]) {
      const outcome = judgeHttp(ok(status), 400);
      expect(outcome.state, `HTTP ${status}`).toBe("broken");
    }
  });

  it("says plainly that the API accepted it", () => {
    // Not asserting wording, only that the status a judge would ask about is in it.
    expect(judgeHttp(ok(200), 400).detail).toContain("200");
  });

  it("is broken whatever status the attack expected", () => {
    for (const expected of [400, 401, 403, 409]) {
      expect(judgeHttp(ok(200), expected).state, String(expected)).toBe("broken");
    }
  });
});

describe("a refusal is the success case", () => {
  it("holds when the expected status comes back", () => {
    expect(judgeHttp(ok(400), 400).state).toBe("held");
    expect(judgeHttp(ok(401), 401).state).toBe("held");
  });

  /* Still a refusal, but not the one the row describes. It passes, and it
     says the status differed rather than quietly claiming the expected one. */
  it("holds on a different 4xx, and does not pretend it was the expected one", () => {
    const outcome = judgeHttp(ok(403), 400);
    expect(outcome.state).toBe("held");
    expect(outcome.detail).toContain("403");
    expect(outcome.detail).toContain("400");
  });

  /* The gateway picks 400 vs 500 by matching our own prose. A guard that
     drifts out of that pattern still refuses, but reports itself as an
     outage - so a 500 must not be counted as a clean pass. */
  it("does not call a 500 a clean refusal", () => {
    for (const status of [500, 502, 503]) {
      expect(judgeHttp(ok(status), 400).state, String(status)).toBe("unknown");
    }
  });
});

describe("the network failing is not a pass", () => {
  /* A screen about refusals must not fall over when the network does - and it
     must not claim a refusal it never received either. */
  it("reports unreachable as unknown, never as held", () => {
    const outcome = judgeHttp({ ok: false, error: "Failed to fetch" }, 400);
    expect(outcome.state).toBe("unknown");
    expect(outcome.state).not.toBe("held");
  });

  it("carries the reason through, so it is debuggable from the screen", () => {
    expect(judgeHttp({ ok: false, error: "Failed to fetch" }, 400).detail).toContain("Failed to fetch");
  });

  it("never throws, whatever came back", () => {
    const results: HttpResult[] = [
      ok(0),
      ok(600),
      ok(400, ""),
      { ok: false, error: "" },
      ok(Number.NaN),
    ];
    for (const r of results) {
      expect(() => judgeHttp(r, 400), JSON.stringify(r)).not.toThrow();
      expect(["held", "broken", "unknown"]).toContain(judgeHttp(r, 400).state);
    }
  });
});

/* ------------------------------------------------------------------ *
 * The tamper demo, against a real hash chain built the way the ledger
 * builds one - linkDecision, the same function appendDecision uses.
 * ------------------------------------------------------------------ */

const chainOf = (n: number): DecisionRecord[] => {
  const chain: DecisionRecord[] = [];
  let prev: DecisionRecord | null = null;
  for (let i = 0; i < n; i++) {
    const rec = linkDecision(prev, {
      taskId: `task_${i}`,
      agent: "producer",
      agentCardId: "Charkha Producer@0.1.0",
      action: `action_${i}`,
      inputHash: hashPayload({ i }),
      outputHash: hashPayload({ o: i }),
      modelHash: null,
      confidence: 0.5,
    });
    chain.push(rec);
    prev = rec;
  }
  return chain;
};

describe("editing a ledger row breaks the chain where it was edited", () => {
  const chain = chainOf(6);

  it("starts from a chain that actually verifies", () => {
    // A tamper demo against an already-broken chain proves nothing.
    expect(verifyHere(chain).valid).toBe(true);
  });

  it("breaks at exactly the row that was changed", () => {
    for (const seq of [0, 3, 5]) {
      const after = verifyHere(tamperAt(chain, seq, "action", "something-else"));
      expect(after.valid, `seq ${seq}`).toBe(false);
      const outcome = judgeTamper(verifyHere(chain), after, seq);
      expect(outcome.state, `seq ${seq}`).toBe("held");
      expect(outcome.detail, `seq ${seq}`).toContain(String(seq));
    }
  });

  it("notices a changed confidence, not just a changed action", () => {
    const after = verifyHere(tamperAt(chain, 2, "confidence", "0.99"));
    expect(judgeTamper(verifyHere(chain), after, 2).state).toBe("held");
  });

  /* The mirror of the 2xx branch: if the chain still verified after an edit,
     tamper-evidence is not working and the row must go red. */
  it("calls a chain that survives an edit broken", () => {
    const before = verifyHere(chain);
    const outcome = judgeTamper(before, { valid: true, length: 6 }, 2);
    expect(outcome.state).toBe("broken");
  });

  /* It noticed something, but not what we did. That is not the guarantee we
     claim on screen, so it must not be painted as one. */
  it("does not pass when the break lands somewhere else", () => {
    const before = verifyHere(chain);
    const elsewhere = { valid: false as const, length: 6, brokenAtSeq: 4, reason: "x" };
    const outcome = judgeTamper(before, elsewhere, 2);
    expect(outcome.state).toBe("unknown");
    expect(outcome.detail).toContain("4");
    expect(outcome.detail).toContain("2");
  });

  it("refuses to prove anything against a chain that was already broken", () => {
    const broken = { valid: false as const, length: 6, brokenAtSeq: 1, reason: "x" };
    expect(judgeTamper(broken, broken, 2).state).toBe("unknown");
  });

  /* The screen must never write. Editing has to happen on a copy, or a judge
     pressing the button would corrupt what is on screen for everyone after. */
  it("does not modify the chain it was given", () => {
    const original = chainOf(4);
    const snapshot = JSON.stringify(original);
    tamperAt(original, 1, "action", "edited");
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(verifyHere(original).valid).toBe(true);
  });

  it("leaves every other row untouched", () => {
    const after = tamperAt(chain, 2, "action", "edited");
    for (const rec of after) {
      if (rec.seq === 2) continue;
      expect(rec).toEqual(chain[rec.seq]);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Finding something real to attack. Nothing is hard-coded: the screen reads
 * the live ledger and attacks whatever it actually finds.
 * ------------------------------------------------------------------ */

const EVIDENCE: FieldEvidence = {
  evidenceId: "ev_real",
  matchId: "match_real",
  at: { lat: 31.64, lon: 74.15 },
  capturedAt: "2026-09-12T08:36:30.774Z",
  imageHash: "4".repeat(64),
  modelHash: "e".repeat(64),
  modelVersion: "0.1.0-baseline",
  clientScores: { good_char: 0.98 },
  batch: {
    pyrolysisPeakTempC: 520,
    residenceTimeMin: 45,
    feedstock: "mixed",
    outputTonnes: 0.4,
    hcOrgRatio: 0.32,
  },
};

const bundle = (over: Partial<TraceBundle>): TraceBundle =>
  ({
    taskId: "task",
    lot: null,
    match: null,
    evidence: null,
    verification: null,
    credit: null,
    chain: [],
    chainValid: true,
    ...over,
  }) as TraceBundle;

const MATCH = { matchId: "match_real" } as TraceBundle["match"];
const CREDIT = { creditId: "crd_real", evidenceId: "ev_real" } as TraceBundle["credit"];

describe("picking a real target off the live system", () => {
  it("finds a credited batch to attack twice", () => {
    const targets = pickTargets([bundle({ match: MATCH, evidence: EVIDENCE, credit: CREDIT })]);
    expect(targets.credited).toMatchObject({
      matchId: "match_real",
      evidenceId: "ev_real",
      creditId: "crd_real",
    });
  });

  /* The credit has to belong to the evidence in the same bundle. Pairing a
     credit with somebody else's evidence would send the screen after an
     attack that is refused for the wrong reason. */
  it("will not pair a credit with evidence it does not belong to", () => {
    const mismatched = { creditId: "crd_real", evidenceId: "ev_other" } as TraceBundle["credit"];
    const targets = pickTargets([bundle({ match: MATCH, evidence: EVIDENCE, credit: mismatched })]);
    expect(targets.credited).toBeNull();
  });

  it("finds a refused batch, which makes the forged verdict sharper", () => {
    const verification = { evidenceId: "ev_bad", verdict: "rejected" } as TraceBundle["verification"];
    const targets = pickTargets([bundle({ match: MATCH, verification })]);
    expect(targets.refused).toMatchObject({ evidenceId: "ev_bad", verdict: "rejected" });
  });

  it("does not treat an accepted verdict as a refused one", () => {
    const verification = { evidenceId: "ev_good", verdict: "accepted" } as TraceBundle["verification"];
    expect(pickTargets([bundle({ match: MATCH, verification })]).refused).toBeNull();
  });

  it("takes needs_review as refused too - it is not a credit either", () => {
    const verification = { evidenceId: "ev_grey", verdict: "needs_review" } as TraceBundle["verification"];
    expect(pickTargets([bundle({ match: MATCH, verification })]).refused).toMatchObject({ verdict: "needs_review" });
  });

  /* A batch that was refused and then somehow credited is not a clean target
     for "supply your own verdict" - the refusal we would get is about the
     existing credit, not about the verdict. */
  it("skips a refused batch that already carries a credit", () => {
    const verification = { evidenceId: "ev_bad", verdict: "rejected" } as TraceBundle["verification"];
    const targets = pickTargets([bundle({ match: MATCH, verification, credit: CREDIT, evidence: EVIDENCE })]);
    expect(targets.refused).toBeNull();
  });

  it("says so honestly when there is nothing to attack yet", () => {
    expect(pickTargets([])).toEqual({ credited: null, refused: null });
    expect(pickTargets([bundle({})])).toEqual({ credited: null, refused: null });
  });

  it("takes the first of each and stops looking", () => {
    const first = bundle({ match: MATCH, evidence: EVIDENCE, credit: CREDIT });
    const second = bundle({
      match: { matchId: "match_later" } as TraceBundle["match"],
      evidence: { ...EVIDENCE, evidenceId: "ev_later" },
      credit: { creditId: "crd_later", evidenceId: "ev_later" } as TraceBundle["credit"],
    });
    expect(pickTargets([first, second]).credited?.creditId).toBe("crd_real");
  });

  it("never throws on a bundle that is missing pieces", () => {
    const partials = [
      bundle({ match: MATCH }),
      bundle({ evidence: EVIDENCE }),
      bundle({ credit: CREDIT }),
      bundle({ match: MATCH, credit: CREDIT }),
    ];
    expect(() => pickTargets(partials)).not.toThrow();
  });
});

describe("the payloads the attacks send", () => {
  it("reuses the photograph exactly, changing only the evidence id", () => {
    const payload = duplicatePhotoPayload(EVIDENCE, "ev_break_it_1");
    expect(payload.evidenceId).toBe("ev_break_it_1");
    expect(payload.imageHash).toBe(EVIDENCE.imageHash);
    expect(payload.modelHash).toBe(EVIDENCE.modelHash);
    expect(payload.matchId).toBe(EVIDENCE.matchId);
    expect(payload.clientScores).toEqual(EVIDENCE.clientScores);
    expect(payload.batch).toEqual(EVIDENCE.batch);
  });

  it("does not modify the evidence it copied", () => {
    duplicatePhotoPayload(EVIDENCE, "ev_break_it_2");
    expect(EVIDENCE.evidenceId).toBe("ev_real");
  });

  it("attaches a verdict the contract has no field for", () => {
    const payload = forgedVerdictPayload("match_real", "ev_real");
    expect(payload["verdict"]).toBe("accepted");
    expect(payload["matchId"]).toBe("match_real");
    expect(payload["evidenceId"]).toBe("ev_real");
  });
});

describe("the screen explains itself before it is pressed", () => {
  it("describes six attacks", () => {
    expect(ATTACKS).toHaveLength(6);
  });

  it("gives every attack a distinct id", () => {
    expect(new Set(ATTACKS.map((a) => a.id)).size).toBe(ATTACKS.length);
  });

  /* A judge should understand the attack from the row, not from somebody
     narrating it. Every row states what it tries and what stops it. */
  it("says what it tries and why it must fail", () => {
    for (const attack of ATTACKS) {
      expect(attack.title.length, attack.id).toBeGreaterThan(0);
      expect(attack.tries.length, attack.id).toBeGreaterThan(20);
      expect(attack.guard.length, attack.id).toBeGreaterThan(20);
    }
  });

  it("knows which status a correct refusal carries, where it makes a call", () => {
    for (const attack of ATTACKS) {
      if (attack.expect === null) continue;
      expect(attack.expect, attack.id).toBeGreaterThanOrEqual(400);
    }
  });
});
