import { describe, expect, it } from "vitest";
import { FieldEvidence, type VerifyEvidenceOutput } from "@charkha/core";
import { CANARY_PREFIX, CLASSES } from "../../../../../agents/verifier/src/protocol.ts";
import { buildEvidence, type BatchForm, type Scored } from "./evidence.ts";
import { EvidenceQueue, MAX_ATTEMPTS, isRetryable } from "./queue.ts";
import {
  lotFeedstockFromVerdict,
  photoAlreadySent,
  recallLotFeedstock,
  rememberLotFeedstock,
} from "./feedstock.ts";

const scored: Scored = {
  imageHash: "b".repeat(64),
  modelHash: "a".repeat(64),
  modelVersion: "0.1.0-baseline",
  photo: { good_char: 0.9, poor_char: 0.07, not_char: 0.03 },
  canary: { good_char: 0.1, poor_char: 0.2, not_char: 0.7 },
};
const batch: BatchForm = {
  pyrolysisPeakTempC: "550",
  residenceTimeMin: "90",
  feedstock: "paddy_straw",
  outputTonnes: "2.5",
  hcOrgRatio: "",
};
const build = (over: Partial<Parameters<typeof buildEvidence>[0]> = {}) =>
  buildEvidence({
    evidenceId: "ev_1",
    matchId: "match_1",
    at: { lat: 30.9, lon: 75.85 },
    capturedAt: new Date("2026-09-11T11:30:00.000Z"),
    scored,
    batch,
    ...over,
  });

describe("evidence body - the photo never leaves the device", () => {
  it("carries exactly the contract fields and passes the strict contract schema", () => {
    const body = build();
    expect(Object.keys(body).sort()).toEqual(
      ["at", "batch", "capturedAt", "clientScores", "evidenceId", "imageHash", "matchId", "modelHash", "modelVersion"].sort(),
    );
    expect(FieldEvidence.strict().safeParse(body).success).toBe(true);
  });

  it("cannot smuggle extra fields in from the form state", () => {
    const sneaky = { ...batch, image: "data:image/jpeg;base64,/9j/4AAQ" } as BatchForm;
    const body = build({ batch: sneaky, scored: { ...scored, photoDataUrl: "data:..." } as Scored });
    const json = JSON.stringify(body);
    expect(json).not.toMatch(/data:image|base64|photoDataUrl/);
    expect(FieldEvidence.strict().safeParse(body).success).toBe(true);
  });

  it("is a few hundred bytes, not an image", () => {
    expect(JSON.stringify(build()).length).toBeLessThan(1024);
  });

  it("packs photo and canary scores for the server's attestation", () => {
    const { clientScores } = build();
    for (const c of CLASSES) {
      expect(clientScores[c]).toBe(scored.photo[c]);
      expect(clientScores[`${CANARY_PREFIX}${c}`]).toBe(scored.canary[c]);
    }
  });

  it("maps an empty H/C ratio to null and parses numbers", () => {
    const body = build();
    expect(body.batch.hcOrgRatio).toBeNull();
    expect(body.batch.pyrolysisPeakTempC).toBe(550);
    expect(build({ batch: { ...batch, hcOrgRatio: "0.42" } }).batch.hcOrgRatio).toBe(0.42);
  });

  it("refuses non-numeric batch fields and a missing match id", () => {
    expect(() => build({ batch: { ...batch, outputTonnes: "lots" } })).toThrow(/output tonnes/);
    expect(() => build({ batch: { ...batch, residenceTimeMin: "" } })).toThrow(/residence/);
    expect(() => build({ matchId: "  " })).toThrow(/match id/);
  });
});

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const offline = async () => {
  throw new TypeError("Failed to fetch");
};
const verdict = { taskId: "t1", output: { verdict: "accepted" } as VerifyEvidenceOutput };

describe("offline queue", () => {
  it("sends straight through when online", async () => {
    const q = new EvidenceQueue(memory());
    const res = await q.submit(build(), async () => verdict);
    expect(res).toEqual({ status: "sent", result: verdict });
    expect(q.list()).toHaveLength(0);
  });

  it("holds the submission when the network is gone, and survives a reload", async () => {
    const store = memory();
    const res = await new EvidenceQueue(store).submit(build(), offline);
    expect(res.status).toBe("queued");
    // a fresh queue over the same storage = the page was reloaded
    expect(new EvidenceQueue(store).list().map((i) => i.evidence.evidenceId)).toEqual(["ev_1"]);
  });

  it("retries and delivers when the network returns", async () => {
    const q = new EvidenceQueue(memory());
    await q.submit(build({ evidenceId: "ev_a" }), offline);
    await q.submit(build({ evidenceId: "ev_b" }), offline);

    const stillOffline = await q.flush(offline);
    expect(stillOffline.sent).toHaveLength(0);
    expect(q.list()).toHaveLength(2);
    expect(q.list()[0]!.attempts).toBe(1); // being offline never counts towards giving up

    const sent: string[] = [];
    const report = await q.flush(async (e) => {
      sent.push(e.evidenceId);
      return verdict;
    });
    expect(sent).toEqual(["ev_a", "ev_b"]); // oldest first
    expect(report.sent).toHaveLength(2);
    expect(q.list()).toHaveLength(0);
  });

  it("does not queue a payload the server rejected as invalid (4xx) - retrying it would be a lie", async () => {
    const q = new EvidenceQueue(memory());
    const res = await q.submit(build(), async () => {
      throw new Error("/evidence -> HTTP 422");
    });
    expect(res.status).toBe("failed");
    expect(q.list()).toHaveLength(0);
  });

  it("queues on a server error: the gateway answers 500 when the verifier is restarting, and that evidence must not be lost", async () => {
    const q = new EvidenceQueue(memory());
    const res = await q.submit(build(), async () => {
      throw new Error("/evidence -> HTTP 500");
    });
    expect(res.status).toBe("queued");
    expect(q.list()).toHaveLength(1);
  });

  it("a server error on one item does not block the items behind it", async () => {
    const q = new EvidenceQueue(memory());
    await q.submit(build({ evidenceId: "ev_bad" }), offline);
    await q.submit(build({ evidenceId: "ev_good" }), offline);
    const report = await q.flush(async (e) => {
      if (e.evidenceId === "ev_bad") throw new Error("/evidence -> HTTP 500");
      return verdict;
    });
    expect(report.sent.map((s) => s.evidenceId)).toEqual(["ev_good"]);
    expect(q.list().map((i) => i.evidence.evidenceId)).toEqual(["ev_bad"]);
  });

  it("gives up on an item after MAX_ATTEMPTS server errors and reports it", async () => {
    const q = new EvidenceQueue(memory());
    await q.submit(build(), offline); // attempts = 1
    const failing = async () => {
      throw new Error("/evidence -> HTTP 500");
    };
    for (let i = 1; i < MAX_ATTEMPTS - 1; i++) expect((await q.flush(failing)).failed).toHaveLength(0);
    const last = await q.flush(failing);
    expect(last.failed).toEqual([{ evidenceId: "ev_1", error: `gave up after ${MAX_ATTEMPTS} attempts: /evidence -> HTTP 500` }]);
    expect(q.list()).toHaveLength(0);
  });

  it("never gives up while simply offline", async () => {
    const q = new EvidenceQueue(memory());
    await q.submit(build(), offline);
    for (let i = 0; i < MAX_ATTEMPTS + 5; i++) await q.flush(offline);
    expect(q.list()).toHaveLength(1);
  });

  it("drops a queued item the server rejects as invalid on retry and reports it", async () => {
    const q = new EvidenceQueue(memory());
    await q.submit(build(), offline);
    const report = await q.flush(async () => {
      throw new Error("/evidence -> HTTP 400");
    });
    expect(report.failed).toEqual([{ evidenceId: "ev_1", error: "/evidence -> HTTP 400" }]);
    expect(q.list()).toHaveLength(0);
  });

  it("does not duplicate an evidenceId that is queued twice", async () => {
    const q = new EvidenceQueue(memory());
    await q.submit(build(), offline);
    await q.submit(build(), offline);
    expect(q.list()).toHaveLength(1);
  });

  it("does not run two flushes at once", async () => {
    const q = new EvidenceQueue(memory());
    await q.submit(build(), offline);
    let calls = 0;
    const slow = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return verdict;
    };
    await Promise.all([q.flush(slow), q.flush(slow)]);
    expect(calls).toBe(1);
  });

  it("tolerates corrupt storage", () => {
    const store = memory();
    store.setItem("charkha.field.queue.v1", "{not json");
    expect(new EvidenceQueue(store).list()).toEqual([]);
  });

  it.each([
    [new TypeError("Failed to fetch"), true],
    [new Error("/evidence -> HTTP 503"), true],
    [new Error("/evidence -> HTTP 504"), true],
    [new Error("/evidence -> HTTP 500"), true],
    [new Error("/evidence -> HTTP 400"), false],
    [new Error("/evidence -> HTTP 422"), false],
  ])("isRetryable(%s) = %s", (err, expected) => {
    expect(isRetryable(err)).toBe(expected);
  });
});

/* ------------------------------------------------------------------ *
 * The feedstock trap: the operator picks blind, and only finds out after a
 * photo and a full inference run. The verdict carries the lot's value, so the
 * view can offer to resend with it instead of leaving a dead end on stage.
 * ------------------------------------------------------------------ */

const verdictWith = (check: { check: string; passed: boolean; detail: string }): VerifyEvidenceOutput =>
  ({
    evidenceId: "ev_1",
    verdict: "rejected",
    charQualityScore: 0.9,
    predictedClass: "good_char",
    confidence: 0.9,
    modelHash: "a".repeat(64),
    modelVersion: "0.1.0-baseline",
    reasons: ["methodology failed: feedstock_matches_lot"],
    methodologyChecks: [check],
  }) as VerifyEvidenceOutput;

describe("recovering from a feedstock mismatch", () => {
  it("reads the lot's feedstock out of the failed check", () => {
    const out = verdictWith({ check: "feedstock_matches_lot", passed: false, detail: "batch paddy_straw, lot mixed" });
    expect(lotFeedstockFromVerdict(out)).toBe("mixed");
  });

  it("reads it for every feedstock the contract allows", () => {
    for (const f of ["paddy_straw", "wheat_straw", "sugarcane_trash", "maize_stover", "mixed"]) {
      const out = verdictWith({ check: "feedstock_matches_lot", passed: false, detail: `batch mixed, lot ${f}` });
      expect(lotFeedstockFromVerdict(out)).toBe(f);
    }
  });

  it("offers nothing when the check passed - there is no mismatch to fix", () => {
    const out = verdictWith({ check: "feedstock_matches_lot", passed: true, detail: "batch mixed, lot mixed" });
    expect(lotFeedstockFromVerdict(out)).toBeNull();
  });

  it("offers nothing when the verdict failed on something else", () => {
    const out = verdictWith({ check: "residence_time", passed: false, detail: "10 min, minimum 30 min" });
    expect(lotFeedstockFromVerdict(out)).toBeNull();
  });

  it("refuses a value that is not a feedstock, rather than sending junk back", () => {
    const out = verdictWith({ check: "feedstock_matches_lot", passed: false, detail: "batch mixed, lot banana" });
    expect(lotFeedstockFromVerdict(out)).toBeNull();
  });

  it("remembers what a lot said, per match id", () => {
    const store = memory();
    rememberLotFeedstock(store, "match_a", "mixed");
    rememberLotFeedstock(store, "match_b", "wheat_straw");
    expect(recallLotFeedstock(store, "match_a")).toBe("mixed");
    expect(recallLotFeedstock(store, "match_b")).toBe("wheat_straw");
    expect(recallLotFeedstock(store, "match_never_seen")).toBeNull();
  });

  it("survives storage being unavailable, as in a private window", () => {
    const broken = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(() => rememberLotFeedstock(broken, "match_a", "mixed")).not.toThrow();
    expect(recallLotFeedstock(broken, "match_a")).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * One photograph, one submission.
 *
 * The verifier enforces this in the database now: evidence.image_hash is
 * unique, and a second evidence id carrying a photo we have already stored is
 * refused as a double-count attempt (#46). That refusal is a 400, which the
 * queue treats as final - so resending the same bytes is not a retry that
 * eventually succeeds. It is evidence dropped, and an honest operator told we
 * refuse "to credit the same image twice".
 *
 * Which makes the #42 recovery path - resend this photo carrying the lot's
 * feedstock - impossible by construction. Correcting a mismatch has to mean a
 * new photograph with the lot's value already filled in.
 * ------------------------------------------------------------------ */
describe("a photograph can only be sent once", () => {
  it("nothing has been sent yet, so the first submission is free", () => {
    expect(photoAlreadySent(null, "a".repeat(64))).toBe(false);
  });

  it("catches a resend of the exact photo already submitted", () => {
    const shot = "a".repeat(64);
    expect(photoAlreadySent(shot, shot)).toBe(true);
  });

  it("lets a genuinely new photograph through", () => {
    expect(photoAlreadySent("a".repeat(64), "b".repeat(64))).toBe(false);
  });

  /* The exact move the feedstock recovery button used to make: same bytes,
     new evidence id, corrected feedstock. Legitimate intent, refused payload. */
  it("refuses the corrected resend the feedstock recovery used to send", () => {
    expect(photoAlreadySent(scored.imageHash, scored.imageHash)).toBe(true);
  });
});
