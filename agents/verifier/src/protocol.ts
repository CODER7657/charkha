/* ------------------------------------------------------------------ *
 * OWNER: Hem
 *
 * The model protocol shared by the verifier (onnxruntime-node) and the field
 * view (onnxruntime-web). Pure and dependency-free on purpose: the browser
 * imports this exact file, so there is one definition of the classes, the
 * preprocessing and the canary, not two that drift.
 *
 * Mirrors ml/train/charmodel.py value for value. The parity fixture
 * (agents/verifier/test/fixtures/parity.json) pins the two together.
 * ------------------------------------------------------------------ */

/** Output order of the model's probability vector. */
export const CLASSES = ["good_char", "poor_char", "not_char"] as const;
export type CharClass = (typeof CLASSES)[number];

export const INPUT_SIZE = 224;
export const INPUT_DIMS = [1, 3, INPUT_SIZE, INPUT_SIZE] as const;
export const MEAN = [0.485, 0.456, 0.406] as const;
export const STD = [0.229, 0.224, 0.225] as const;

/**
 * THE CANARY.
 *
 * The server never sees the photo, so it cannot re-score it. What it can do
 * is prove the browser ran the same model on the same runtime semantics:
 * both sides build a pseudo-random tensor seeded from `imageHash`, both run
 * the model on it, and the browser sends its canary scores alongside the
 * photo scores in `clientScores` under `canary:<class>` keys. If the server's
 * onnxruntime-node result differs, the client ran a different model, a
 * broken runtime, or tampered with the numbers - and the verdict is
 * needs_review.
 *
 * Seeding from imageHash binds the canary to this piece of evidence, so a
 * canary answer cannot be replayed onto a different photo.
 */
export const CANARY_PREFIX = "canary:";

/** Width and height of the canary tensor match the real input exactly. */
export const canaryTensor = (imageHash: string): Float32Array => {
  if (!/^[0-9a-f]{64}$/.test(imageHash)) throw new Error("imageHash must be 64 lowercase hex chars");
  // FNV-1a fold of the digest's eight 32-bit words. Not XOR: XOR cancels
  // repeated words, so distinct hashes would share a canary.
  let state = 0x811c9dc5;
  for (let i = 0; i < 64; i += 8) state = Math.imul(state ^ parseInt(imageHash.slice(i, i + 8), 16), 0x01000193) >>> 0;
  if (state === 0) state = 0x9e3779b9;
  const out = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
  for (let i = 0; i < out.length; i++) {
    // xorshift32
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    // 24 bits scaled into [-2, 2): exactly representable in float32.
    out[i] = ((state >>> 8) / 16777216) * 4 - 2;
  }
  return out;
};

export type ClassScores = Record<CharClass, number>;

/** The body the browser sends in `clientScores`: photo scores + canary scores. */
export const packClientScores = (photo: ClassScores, canary: ClassScores): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const c of CLASSES) {
    out[c] = photo[c];
    out[`${CANARY_PREFIX}${c}`] = canary[c];
  }
  return out;
};

/** Model output vector -> named scores. */
export const toClassScores = (probs: ArrayLike<number>): ClassScores => {
  if (probs.length !== CLASSES.length) throw new Error(`expected ${CLASSES.length} scores, got ${probs.length}`);
  return Object.fromEntries(CLASSES.map((c, i) => [c, Number(probs[i])])) as ClassScores;
};

export const topClass = (scores: ClassScores): { cls: CharClass; p: number } =>
  CLASSES.reduce((best, c) => (scores[c] > best.p ? { cls: c, p: scores[c] } : best), {
    cls: CLASSES[0] as CharClass,
    p: -1,
  });

/**
 * RGBA pixels (canvas ImageData, already resized to INPUT_SIZE square) ->
 * ImageNet-normalised NCHW float32. Same maths as torchvision's
 * ToTensor + Normalize used in training.
 */
export const rgbaToNchw = (rgba: ArrayLike<number>, width: number, height: number): Float32Array => {
  if (rgba.length !== width * height * 4) throw new Error("rgba length does not match width x height x 4");
  const plane = width * height;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) {
      out[c * plane + i] = (rgba[i * 4 + c]! / 255 - MEAN[c]!) / STD[c]!;
    }
  }
  return out;
};

/** Shape of the sidecar JSON written next to the .onnx by export_onnx.py. */
export type ModelSidecar = {
  version: string;
  sha256: string;
  classes: string[];
  inputName: string;
  outputName: string;
  inputSize: number;
  kind: string;
};
