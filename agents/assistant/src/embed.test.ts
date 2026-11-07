import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EMBED_FLOOR,
  EMBED_MARGIN,
  FERTILITY_MAX,
  embedEnabled,
  embedderFromEnv,
  makeEmbedCandidates,
  type Embedder,
} from "./embed.ts";

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

/* ------------------------------------------------------------------ *
 * Loading the model from wherever the box put it.
 *
 * The bytes are not in this repo and never will be - they are mounted on the
 * VM as a volume, the way the FIRMS cache already is. So the paths are env
 * vars, and every way they can be wrong has to end in Tier 1 rather than in a
 * stack trace: a flag-gated enhancement that can take down a working resolver
 * is worse than not having the enhancement.
 *
 * Every test here runs with no model on disk. That is deliberate - CI has no
 * model either, and a test that needs a 112 MB download is a test nobody runs.
 * ------------------------------------------------------------------ */
describe("finding the model, and every way that can fail", () => {
  const paths = {
    ASSISTANT_EMBED_MODEL: "/nonexistent/model.onnx",
    ASSISTANT_EMBED_TOKENIZER: "/nonexistent/tokenizer.json",
  };

  it("is off unless the flag is exactly 1", () => {
    expect(embedEnabled({})).toBe(false);
    expect(embedEnabled({ ASSISTANT_EMBED: "0" })).toBe(false);
    expect(embedEnabled({ ASSISTANT_EMBED: "true" })).toBe(false);
    expect(embedEnabled({ ASSISTANT_EMBED: "" })).toBe(false);
    expect(embedEnabled({ ASSISTANT_EMBED: "1" })).toBe(true);
  });

  it("returns no embedder when the flag is off, whatever the paths say", async () => {
    expect(await embedderFromEnv({ ...paths })).toBeNull();
    expect(await embedderFromEnv({ ...paths, ASSISTANT_EMBED: "0" })).toBeNull();
  });

  it("returns no embedder when a path is missing from the environment", async () => {
    expect(await embedderFromEnv({ ASSISTANT_EMBED: "1" })).toBeNull();
    expect(
      await embedderFromEnv({ ASSISTANT_EMBED: "1", ASSISTANT_EMBED_MODEL: paths.ASSISTANT_EMBED_MODEL }),
    ).toBeNull();
    expect(
      await embedderFromEnv({ ASSISTANT_EMBED: "1", ASSISTANT_EMBED_TOKENIZER: paths.ASSISTANT_EMBED_TOKENIZER }),
    ).toBeNull();
  });

  /* The volume did not get mounted. Common, and it must not be fatal. */
  it("returns no embedder when the files are not on disk, and does not throw", async () => {
    await expect(embedderFromEnv({ ASSISTANT_EMBED: "1", ...paths })).resolves.toBeNull();
  });

  it("returns no embedder when the files exist but are not a model, and does not throw", async () => {
    const dir = mkdtempSync(join(tmpdir(), "charkha-embed-"));
    const model = join(dir, "model.onnx");
    const tokenizer = join(dir, "tokenizer.json");
    writeFileSync(model, "not an onnx file");
    writeFileSync(tokenizer, "{ not json");

    await expect(
      embedderFromEnv({ ASSISTANT_EMBED: "1", ASSISTANT_EMBED_MODEL: model, ASSISTANT_EMBED_TOKENIZER: tokenizer }),
    ).resolves.toBeNull();

    rmSync(dir, { recursive: true, force: true });
  });
});

/* ------------------------------------------------------------------ *
 * Somewhere to put a sentence that is not about us.
 *
 * An embedding never abstains. It returns the nearest prototype whatever you
 * feed it, so with only in-domain examples the nearest one always wins - and
 * the real model duly resolved "asdkjh qwe zxcvb" to `run_matching` at 0.73,
 * which cleared both the floor and the margin honestly.
 *
 * A floor cannot fix that: the score was high. What fixes it is giving
 * out-of-domain sentences their own prototypes, so nonsense has something
 * closer to land on than a real intent.
 * ------------------------------------------------------------------ */
describe("out-of-domain sentences have somewhere to land", () => {
  const near = vec(1, 0, 0);
  const far = vec(0, 1, 0);

  it("produces no candidate when the nearest prototype is an out-of-domain one", async () => {
    const embedder = fake({
      "what happened to our waste": far,
      "what is the weather tomorrow": near,
      "asdkjh qwe zxcvb": near,
    });
    const candidates = makeEmbedCandidates({
      enabled: true,
      embedder,
      prototypes: { lot_status: ["what happened to our waste"], unknown: ["what is the weather tomorrow"] },
    });

    expect(await candidates("asdkjh qwe zxcvb")).toEqual([]);
  });

  it("still answers a real intent when that is what is nearest", async () => {
    const embedder = fake({
      "what happened to our waste": near,
      "what is the weather tomorrow": far,
      "where did our load go": near,
    });
    const candidates = makeEmbedCandidates({
      enabled: true,
      embedder,
      prototypes: { lot_status: ["what happened to our waste"], unknown: ["what is the weather tomorrow"] },
    });

    const out = await candidates("where did our load go");
    expect(out).toHaveLength(1);
    expect(out[0]!.intent).toBe("lot_status");
  });
});

/* ------------------------------------------------------------------ *
 * Nonsense, caught by how it tokenises rather than by what it means.
 *
 * Out-of-domain prototypes did not stop "asdkjh qwe zxcvb" scoring 0.73 as
 * run_matching. Gibberish embeds unpredictably, so no amount of example
 * nonsense reliably sits nearer to it than a real intent does.
 *
 * But nonsense tokenises differently, and measurably so. Real sentences
 * fragment into 0.33-0.48 tokens per character in all four languages;
 * gibberish into 0.82-1.00, because the model has no subword for it. The gap
 * has nothing in it, and Punjabi - the highest real value at 0.478 - is still
 * far below the lowest nonsense at 0.824, so the guard does not punish the
 * scripts this screen exists for.
 * ------------------------------------------------------------------ */
describe("gibberish is refused on how it tokenises", () => {
  const near = vec(1, 0, 0);
  const protos = { lot_status: ["what happened to our waste"] };

  it("abstains when the text fragments far more than real language does", async () => {
    const embedder = fake({ "what happened to our waste": near, "asdkjh qwe zxcvb": near });
    const candidates = makeEmbedCandidates({
      enabled: true,
      embedder,
      prototypes: protos,
      fertility: () => 0.86,
    });
    expect(await candidates("asdkjh qwe zxcvb")).toEqual([]);
  });

  it("answers normally at the fertility of real language, including Punjabi", async () => {
    const embedder = fake({ "what happened to our waste": near, "where did our load go": near });
    const candidates = makeEmbedCandidates({
      enabled: true,
      embedder,
      prototypes: protos,
      fertility: () => 0.478,
    });
    const out = await candidates("where did our load go");
    expect(out).toHaveLength(1);
    expect(out[0]!.intent).toBe("lot_status");
  });

  it("works unchanged when no fertility signal is supplied", async () => {
    const embedder = fake({ "what happened to our waste": near, "where did our load go": near });
    const candidates = makeEmbedCandidates({ enabled: true, embedder, prototypes: protos });
    expect(await candidates("where did our load go")).toHaveLength(1);
  });

  it("the threshold sits in the empty gap between real text and nonsense", () => {
    expect(FERTILITY_MAX).toBeGreaterThan(0.478);
    expect(FERTILITY_MAX).toBeLessThan(0.824);
  });
});
