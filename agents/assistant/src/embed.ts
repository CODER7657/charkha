import type { AssistantIntent } from "@charkha/core";

/* ------------------------------------------------------------------ *
 * OWNER: Hem
 *
 * Tier 2: semantic intent, for the sentence we did not anticipate.
 *
 * Tier 1 answers the phrasings we wrote down. Measured against twelve held-out
 * sentences it answered none of them - every one I had tuned for passed and
 * nothing else did, which is what overfitting looks like when it is written by
 * hand. Embeddings reach those; that is the whole reason this exists.
 *
 * The scoring here is deliberately more suspicious than a threshold, because
 * of one result from the spike:
 *
 *     sim=0.93   ਸਾਨੂੰ ਦੱਸੋ ਇਹ ਸਭ ਕਿਵੇਂ ਹੁੰਦਾ ਹੈ   ->  lot_status   (wanted how_it_works)
 *
 * Confidently wrong, because no prototype existed for that intent in that
 * language, so the nearest Punjabi sentence won. A high cosine is not evidence
 * on its own - it is only evidence when the runner-up is clearly further away.
 * Hence the margin. A near-tie abstains, and Tier 1 answers instead.
 *
 * The embedder is injected so this is testable with no model and no megabytes.
 * ------------------------------------------------------------------ */

export type Candidate = { intent: AssistantIntent; score: number };

/** Text in, unit vector out. Async because ONNX inference is. */
export type Embedder = (text: string) => Promise<Float32Array>;

/** Below this the nearest prototype is not near enough to mean anything. */
export const EMBED_FLOOR = 0.5;

/**
 * How far the best intent must beat the second before we believe it.
 *
 * The spike's 0.93 mistake had a runner-up almost as close. Requiring a gap
 * turns that case into an abstention, which Tier 1 then answers correctly or
 * refuses honestly - either being better than a confident wrong intent.
 */
export const EMBED_MARGIN = 0.08;

/**
 * Tokens per character, above which the text is not language.
 *
 * An embedding never abstains, and out-of-domain prototypes did not stop
 * "asdkjh qwe zxcvb" scoring 0.73 as run_matching - nonsense embeds
 * unpredictably, so no set of example nonsense reliably sits nearer to it.
 *
 * How it TOKENISES is a different signal entirely, and a clean one. Measured
 * on this tokenizer: real sentences fragment at 0.33-0.48 tokens per character
 * across all four languages, nonsense at 0.82-1.00, because the model has no
 * subword for it. Nothing lands between. Punjabi is the highest real value at
 * 0.478 and still far below the lowest nonsense at 0.824, so this does not
 * penalise the scripts the screen exists for.
 */
export const FERTILITY_MAX = 0.65;

export type EmbedDeps = {
  /** ASSISTANT_EMBED=1. Off by default; the whole tier can be switched off without a deploy. */
  enabled: boolean;
  /** null when the model is absent or failed to load. */
  embedder: Embedder | null;
  /** Example utterances per intent. Needs coverage in every language, or the 0.93 case returns. */
  prototypes: Partial<Record<AssistantIntent, readonly string[]>>;
  /** Tokens per character. Optional: without it the fertility guard is simply not applied. */
  fertility?: (text: string) => number;
};

const cosine = (a: Float32Array, b: Float32Array): number => {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i]! * b[i]!;
  return dot;
};

export const makeEmbedCandidates = (deps: EmbedDeps) => {
  /* Prototypes are embedded once, on the first request that needs them.
     Re-embedding per request would multiply latency by the example count, and
     doing it at import time would pay the cost even when the flag is off. */
  let warmed: Promise<Array<{ intent: AssistantIntent; vector: Float32Array }>> | null = null;

  const warm = async (embedder: Embedder) => {
    const out: Array<{ intent: AssistantIntent; vector: Float32Array }> = [];
    for (const [intent, examples] of Object.entries(deps.prototypes)) {
      for (const example of examples ?? []) {
        out.push({ intent: intent as AssistantIntent, vector: await embedder(example) });
      }
    }
    return out;
  };

  return async (text: string): Promise<Candidate[]> => {
    const { enabled, embedder } = deps;
    if (!enabled || !embedder) return [];

    try {
      /* Cheaper than inference and checked first: if this is not language, no
         amount of similarity to a real intent makes it one. */
      if (deps.fertility && deps.fertility(text) > FERTILITY_MAX) return [];

      warmed ??= warm(embedder);
      const prototypes = await warmed;
      if (!prototypes.length) return [];

      const vector = await embedder(text);

      /* Best score per intent, then rank intents - not prototypes. Three
         examples of one intent must not out-vote one example of another. */
      const best = new Map<AssistantIntent, number>();
      for (const p of prototypes) {
        const score = cosine(vector, p.vector);
        if (score > (best.get(p.intent) ?? -Infinity)) best.set(p.intent, score);
      }

      const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]);
      const [top, second] = ranked;
      if (!top) return [];

      /* An embedding never abstains - it returns the nearest prototype whatever
         you give it. With only in-domain examples the nearest one always wins,
         and the real model duly scored "asdkjh qwe zxcvb" as run_matching at
         0.73, clearing both the floor and the margin honestly. Out-of-domain
         prototypes give nonsense somewhere closer to land, and landing there
         means say nothing. */
      if (top[0] === "unknown") return [];

      const score = Math.min(1, Math.max(0, top[1]));
      if (score < EMBED_FLOOR) return [];
      if (second && score - second[1] < EMBED_MARGIN) return [];

      return [{ intent: top[0], score }];
    } catch {
      /* A missing or broken model degrades to Tier 1 in silence. Throwing here
         would take down a resolver that works perfectly well without it, which
         is the opposite of what a flag-gated enhancement should do. */
      warmed = null;
      return [];
    }
  };
};

/* ---------- loading the model from wherever the box put it ---------- *
 *
 * The bytes are NOT in this repo. 112 MB of model plus 16 MB of tokenizer in
 * git would be permanent, and the Dockerfile copies `ml/`, so every deploy
 * would carry them - on a host where the redeploy window is already the
 * riskiest minute we have. They are mounted on the VM as a volume instead,
 * exactly as the FIRMS cache is, so the paths have to come from the
 * environment rather than from a path baked in here.
 *
 * Every failure below returns null, which means Tier 1. A missing mount, an
 * unset variable, a truncated download, a model that will not parse: all of
 * them degrade silently to the resolver that already works in four languages.
 * ------------------------------------------------------------------ */

type Env = Record<string, string | undefined>;

/** Exactly "1". Anything else is off, including "true" - a flag that guesses is not a flag. */
export const embedEnabled = (env: Env): boolean => env["ASSISTANT_EMBED"] === "1";

/** Mean-pool the token vectors and L2-normalise, so cosine similarity is a dot product. */
const pool = (data: Float32Array | Float64Array, seq: number, dim: number): Float32Array => {
  const v = new Float64Array(dim);
  for (let t = 0; t < seq; t++) for (let d = 0; d < dim; d++) v[d]! += Number(data[t * dim + d]);
  let norm = 0;
  for (let d = 0; d < dim; d++) {
    v[d]! /= seq;
    norm += v[d]! * v[d]!;
  }
  norm = Math.sqrt(norm) || 1;
  return Float32Array.from(v, (x) => x / norm);
};

/**
 * Build an embedder from the environment, or return null.
 *
 * Never throws. The imports are dynamic so that a run with the flag off never
 * loads onnxruntime at all - the cost of the tier should be zero when it is
 * not in use, not merely small.
 */
export const embedderFromEnv = async (
  env: Env = process.env,
): Promise<{ embed: Embedder; fertility: (text: string) => number } | null> => {
  if (!embedEnabled(env)) return null;

  const modelPath = env["ASSISTANT_EMBED_MODEL"];
  const tokenizerPath = env["ASSISTANT_EMBED_TOKENIZER"];
  if (!modelPath || !tokenizerPath) return null;

  try {
    const { existsSync, readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    if (!existsSync(modelPath) || !existsSync(tokenizerPath)) return null;

    const ort = await import("onnxruntime-node");
    const { Tokenizer } = await import("@huggingface/tokenizers");

    /* tokenizer_config.json sits beside tokenizer.json in every export of
       these models, so it is derived rather than made a third variable
       somebody has to remember to set. Absent, an empty config still loads. */
    const configPath = join(dirname(tokenizerPath), "tokenizer_config.json");
    const config: unknown = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
    const tokenizer = new Tokenizer(JSON.parse(readFileSync(tokenizerPath, "utf8")), config as object);

    const session = await ort.InferenceSession.create(modelPath, { intraOpNumThreads: 1 });

    /* Tokens per character, from the same tokenizer that does the encoding -
       one load, two signals. */
    const fertility = (text: string): number => {
      const encoded = tokenizer.encode(text) as { ids?: number[] } | number[];
      const ids = (encoded as { ids?: number[] }).ids ?? (encoded as number[]);
      const chars = [...text.replace(/\s/g, "")].length;
      return ids.length / Math.max(1, chars);
    };

    const embed = async (text: string): Promise<Float32Array> => {
      const encoded = tokenizer.encode(text) as { ids?: number[] } | number[];
      const ids = Array.from((encoded as { ids?: number[] }).ids ?? (encoded as number[])).map(BigInt);
      const feeds: Record<string, unknown> = {
        input_ids: new ort.Tensor("int64", BigInt64Array.from(ids), [1, ids.length]),
        attention_mask: new ort.Tensor("int64", BigInt64Array.from(ids.map(() => 1n)), [1, ids.length]),
      };
      /* XLM-R does not use them, but the exported graph still declares them. */
      if (session.inputNames.includes("token_type_ids")) {
        feeds["token_type_ids"] = new ort.Tensor("int64", BigInt64Array.from(ids.map(() => 0n)), [1, ids.length]);
      }
      const out = await session.run(feeds as never);
      const hidden = out[session.outputNames[0]!]!;
      const [, seq, dim] = hidden.dims as number[];
      return pool(hidden.data as Float32Array, seq!, dim!);
    };

    return { embed, fertility };
  } catch {
    return null;
  }
};
