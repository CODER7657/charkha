import { describe, expect, it } from "vitest";
import { FieldEvidence, type VerifyEvidenceOutput } from "@charkha/core";
import { CANARY_PREFIX, CLASSES } from "../../../../../agents/verifier/src/protocol.ts";
import { buildEvidence, type BatchForm, type Scored } from "./evidence.ts";
import { EvidenceQueue, isRetryable } from "./queue.ts";

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
    expect(q.list()[0]!.attempts).toBe(2);

    const sent: string[] = [];
    const report = await q.flush(async (e) => {
      sent.push(e.evidenceId);
      return verdict;
    });
    expect(sent).toEqual(["ev_a", "ev_b"]); // oldest first
    expect(report.sent).toHaveLength(2);
    expect(q.list()).toHaveLength(0);
  });

  it("does not queue a payload the server refused - retrying it forever would be a lie", async () => {
    const q = new EvidenceQueue(memory());
    const res = await q.submit(build(), async () => {
      throw new Error("/evidence -> HTTP 500");
    });
    expect(res.status).toBe("failed");
    expect(q.list()).toHaveLength(0);
  });

  it("drops a queued item the server refuses on retry and reports it", async () => {
    const q = new EvidenceQueue(memory());
    await q.submit(build(), offline);
    const report = await q.flush(async () => {
      throw new Error("/evidence -> HTTP 500");
    });
    expect(report.failed).toEqual([{ evidenceId: "ev_1", error: "/evidence -> HTTP 500" }]);
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
    [new Error("/evidence -> HTTP 500"), false],
    [new Error("/evidence -> HTTP 400"), false],
  ])("isRetryable(%s) = %s", (err, expected) => {
    expect(isRetryable(err)).toBe(expected);
  });
});
