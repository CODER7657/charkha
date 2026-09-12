import { describe, expect, it, vi } from "vitest";
import { EMBED_FLOOR, EMBED_MARGIN, makeEmbedCandidates, type Embedder } from "./embed.ts";

/* ------------------------------------------------------------------ *
 * OWNER: Hem
 *
 * Tier 2 scoring, tested with no model and no megabytes.
 *
 * The embedder is injected for the same reason `answer.ts` injects the
 * resolver: a unit test that needs a 112 MB download is a unit test nobody
 * runs, and CI would have to fetch it on every job. What matters here is not
 * whether the model is good - that is measured separately against held-out
 * sentences - but whether the SCORING around it refuses when it should.
 *
 * A wrong confident answer is worse than `unknown`. The spike produced exactly
 * that: 0.93 similarity on the wrong intent, because no prototype existed in
 * that language. So the rules below exist to make a near-miss abstain rather
 * than assert, and they are what these tests pin.
 * ------------------------------------------------------------------ */

/** Unit vectors far enough apart that cosine similarity is exactly predictable. */
const vec = (...xs: number[]): Float32Array => {
  const n = Math.hypot(...xs) || 1;
  return Float32Array.from(xs.map((x) => x / n));
};

/** A fake embedder: every phrase maps to a vector we chose. */
const fake = (table: Record<string, Float32Array>): Embedder => {
  return vi.fn(async (text: string) => table[text] ?? vec(0, 0, 1));
};

const PROTOTYPES = {
  lot_status: ["what happened to our waste"],
  impact_summary: ["how much CO2 did we save"],
} as const;

describe("the flag, and every way the model can be absent", () => {
  it("returns nothing when the flag is off, and never touches the embedder", async () => {
    const embedder = fake({});
    const candidates = makeEmbedCandidates({ enabled: false, embedder, prototypes: PROTOTYPES });
    expect(await candidates("anything at all")).toEqual([]);
    expect(embedder).not.toHaveBeenCalled();
  });

  it("returns nothing when there is no embedder at all", async () => {
    const candidates = makeEmbedCandidates({ enabled: true, embedder: null, prototypes: PROTOTYPES });
    expect(await candidates("anything at all")).toEqual([]);
  });

  /* A model that fails to load must degrade to Tier 1 silently. Throwing here
     would take down a resolver that works perfectly well without it. */
  it("returns nothing when the embedder throws, rather than propagating", async () => {
    const embedder: Embedder = async () => {
      throw new Error("model file missing");
    };
    const candidates = makeEmbedCandidates({ enabled: true, embedder, prototypes: PROTOTYPES });
    await expect(candidates("what happened to our waste")).resolves.toEqual([]);
  });
});

describe("scoring: assert only when the nearest prototype is clearly nearest", () => {
  const near = vec(1, 0, 0);
  const alsoNear = vec(0.99, 0.14, 0);
  const far = vec(0, 1, 0);

  it("produces a candidate when one intent is clearly nearest", async () => {
    const embedder = fake({
      "what happened to our waste": near,
      "how much CO2 did we save": far,
      "did anyone pick up the stubble": near,
    });
    const candidates = makeEmbedCandidates({ enabled: true, embedder, prototypes: PROTOTYPES });
    const out = await candidates("did anyone pick up the stubble");

    expect(out).toHaveLength(1);
    expect(out[0]!.intent).toBe("lot_status");
    expect(out[0]!.score).toBeGreaterThanOrEqual(EMBED_FLOOR);
  });

  it("abstains when nothing is near enough", async () => {
    const embedder = fake({
      "what happened to our waste": near,
      "how much CO2 did we save": far,
      "book me a train": vec(0, 0, 1),
    });
    const candidates = makeEmbedCandidates({ enabled: true, embedder, prototypes: PROTOTYPES });
    expect(await candidates("book me a train")).toEqual([]);
  });

  /* The spike's worst result: 0.93 similarity on the WRONG intent, because the
     right one had no prototype in that language. A high score is not evidence
     when the runner-up is just as close - that is the shape of a near-miss. */
  it("abstains when two intents are nearly equally close, however high the score", async () => {
    const embedder = fake({
      "what happened to our waste": near,
      "how much CO2 did we save": alsoNear,
      "tell us how all this happens": near,
    });
    const candidates = makeEmbedCandidates({ enabled: true, embedder, prototypes: PROTOTYPES });
    const out = await candidates("tell us how all this happens");

    expect(out, "a 0.99-vs-0.98 split is a coin flip, not a match").toEqual([]);
  });

  it("the margin is a real gap, not zero", () => {
    expect(EMBED_MARGIN).toBeGreaterThan(0);
    expect(EMBED_FLOOR).toBeGreaterThan(0);
    expect(EMBED_FLOOR).toBeLessThan(1);
  });

  it("scores are probabilities", async () => {
    const embedder = fake({ "what happened to our waste": near, "how much CO2 did we save": far, q: near });
    const candidates = makeEmbedCandidates({ enabled: true, embedder, prototypes: PROTOTYPES });
    for (const c of await candidates("q")) {
      expect(c.score).toBeGreaterThanOrEqual(0);
      expect(c.score).toBeLessThanOrEqual(1);
    }
  });

  /* Prototypes are embedded once and reused. Re-embedding them per request
     would multiply latency by the size of the example set. */
  it("embeds each prototype once across repeated calls", async () => {
    const embedder = fake({ "what happened to our waste": near, "how much CO2 did we save": far, a: near, b: near });
    const candidates = makeEmbedCandidates({ enabled: true, embedder, prototypes: PROTOTYPES });
    await candidates("a");
    await candidates("b");

    const embedded = (embedder as unknown as { mock: { calls: string[][] } }).mock.calls.map((c) => c[0]);
    expect(embedded.filter((t) => t === "what happened to our waste")).toHaveLength(1);
    expect(embedded.filter((t) => t === "how much CO2 did we save")).toHaveLength(1);
  });
});
