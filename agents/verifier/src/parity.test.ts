import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as ortWeb from "onnxruntime-web";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./modelFiles.ts";
import { openModel } from "./onnx.ts";
import { CLASSES, INPUT_DIMS, INPUT_SIZE, MEAN, STD, canaryTensor, rgbaToNchw, toClassScores } from "./protocol.ts";

/* ------------------------------------------------------------------ *
 * THE PARITY TEST.
 *
 * One .onnx file, three runtimes, one answer:
 *   - Python onnxruntime (expected scores, written by export_onnx.py)
 *   - onnxruntime-node   (the verifier)
 *   - onnxruntime-web    (the field view; its wasm backend, run under Node)
 *
 * If this fails, the verification claim is untrue. Stop and fix it.
 * ------------------------------------------------------------------ */

type Fixture = {
  model: string;
  sha256: string;
  tolerance: number;
  cases: Array<{ name: string; scores: Record<string, number>; inputSha256: string }>;
};

const fixture = JSON.parse(readFileSync(path.join(import.meta.dirname, "../test/fixtures/parity.json"), "utf8")) as Fixture;
const modelPath = path.join(REPO_ROOT, fixture.model);
const modelBytes = readFileSync(modelPath);

/** Rebuild a fixture input exactly as the browser would produce it. */
const inputFor = (name: string): Float32Array => {
  if (name.startsWith("canary:")) return canaryTensor(name.slice("canary:".length));
  const rgb = { "solid:black": [0.05, 0.05, 0.05], "solid:grey": [0.55, 0.55, 0.55], "solid:green": [0.2, 0.7, 0.2] }[name];
  if (!rgb) throw new Error(`unknown fixture case ${name}`);
  const plane = INPUT_SIZE * INPUT_SIZE;
  const out = new Float32Array(3 * plane);
  for (let c = 0; c < 3; c++) out.fill((rgb[c]! - MEAN[c]!) / STD[c]!, c * plane, (c + 1) * plane);
  return out;
};

const sha = (x: Float32Array) => createHash("sha256").update(new Uint8Array(x.buffer, x.byteOffset, x.byteLength)).digest("hex");

describe("model parity: python vs onnxruntime-node vs onnxruntime-web", async () => {
  const node = await openModel(modelPath);
  ortWeb.env.wasm.numThreads = 1;
  const web = await ortWeb.InferenceSession.create(modelBytes, { executionProviders: ["wasm"] });
  const runWeb = async (x: Float32Array) => {
    const out = await web.run({ [web.inputNames[0]!]: new ortWeb.Tensor("float32", x, [...INPUT_DIMS]) });
    return toClassScores(out[web.outputNames[0]!]!.data as Float32Array);
  };

  it("fixture pins the committed model file", () => {
    expect(node.hash).toBe(fixture.sha256);
  });

  it.each(fixture.cases.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    const x = inputFor(c.name);
    // TS input generation matches Python bit for bit
    expect(sha(x)).toBe(c.inputSha256);

    const [n, w] = await Promise.all([node.run(x), runWeb(x)]);
    for (const cls of CLASSES) {
      expect(Math.abs(n[cls] - w[cls]), `node vs web ${cls}`).toBeLessThanOrEqual(fixture.tolerance);
      expect(Math.abs(n[cls] - c.scores[cls]!), `node vs python ${cls}`).toBeLessThanOrEqual(fixture.tolerance);
      expect(Math.abs(w[cls] - c.scores[cls]!), `web vs python ${cls}`).toBeLessThanOrEqual(fixture.tolerance);
    }
    const argmax = (s: Record<string, number>) => CLASSES.reduce((a, b) => (s[b]! > s[a]! ? b : a));
    expect(argmax(n)).toBe(argmax(c.scores));
    expect(argmax(w)).toBe(argmax(c.scores));
  });

  it("the canary tolerance sits well above real runtime drift", async () => {
    const x = canaryTensor("f".repeat(64));
    const [n, w] = await Promise.all([node.run(x), runWeb(x)]);
    const drift = Math.max(...CLASSES.map((c) => Math.abs(n[c] - w[c])));
    expect(drift).toBeLessThan(1e-4);
  });

  it("browser preprocessing of real RGBA pixels matches the solid fixture", async () => {
    const rgba = new Uint8ClampedArray(INPUT_SIZE * INPUT_SIZE * 4);
    for (let i = 0; i < rgba.length; i += 4) rgba.set([13, 13, 13, 255], i); // ~0.05 grey
    const scores = await runWeb(rgbaToNchw(rgba, INPUT_SIZE, INPUT_SIZE));
    expect(CLASSES.reduce((a, b) => (scores[b] > scores[a] ? b : a))).toBe("good_char");
  });
});

describe("canary generator", () => {
  it("is deterministic and depends on the hash", () => {
    const a = canaryTensor("1".repeat(64));
    expect(sha(a)).toBe(sha(canaryTensor("1".repeat(64))));
    expect(sha(a)).not.toBe(sha(canaryTensor("2".repeat(64))));
    expect(a.length).toBe(3 * INPUT_SIZE * INPUT_SIZE);
  });

  it("refuses a malformed hash", () => {
    expect(() => canaryTensor("xyz")).toThrow();
    expect(() => canaryTensor("A".repeat(64))).toThrow();
  });
});
