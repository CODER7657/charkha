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

export type EmbedDeps = {
  /** ASSISTANT_EMBED=1. Off by default; the whole tier can be switched off without a deploy. */
  enabled: boolean;
  /** null when the model is absent or failed to load. */
  embedder: Embedder | null;
  /** Example utterances per intent. Needs coverage in every language, or the 0.93 case returns. */
  prototypes: Partial<Record<AssistantIntent, readonly string[]>>;
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
