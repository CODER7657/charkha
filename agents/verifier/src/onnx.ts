import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

/**
 * OWNER: Hem
 *
 * Load the ONNX model once at boot and hash the file. The hash goes into
 * every decision record - that is how we prove which model version made a
 * given call. Do not skip it.
 *
 * Use onnxruntime-node here. The SAME .onnx file is served to the browser
 * and run with onnxruntime-web in the field view: one artefact, two
 * runtimes. If server and browser ever disagree on the same input, that is
 * a bug worth stopping for - add a fixture test that pins it.
 */

export type LoadedModel = {
  version: string;
  hash: string;
  run: (input: Float32Array) => Promise<Record<string, number>>;
};

let model: LoadedModel | null = null;

export const loadModel = async (): Promise<LoadedModel> => {
  if (model) return model;
  const path = process.env["ONNX_MODEL_PATH"] ?? "./ml/models/char-quality.onnx";
  try {
    const bytes = await readFile(path);
    const hash = createHash("sha256").update(bytes).digest("hex");
    // TODO(hem): const session = await ort.InferenceSession.create(path)
    model = {
      version: process.env["ONNX_MODEL_VERSION"] ?? "0.1.0-stub",
      hash,
      run: async () => ({ good_char: 0.5, poor_char: 0.3, not_char: 0.2 }),
    };
  } catch {
    // Model not trained yet - do not crash the mesh, just be honest about it.
    model = {
      version: "0.0.0-no-model",
      hash: "0".repeat(64),
      run: async () => ({ good_char: 0.5, poor_char: 0.3, not_char: 0.2 }),
    };
    console.warn(`[verifier] no model at ${path} - running in stub mode`);
  }
  return model;
};

export const getModel = (): LoadedModel => {
  if (!model) throw new Error("model not loaded - call loadModel() at boot");
  return model;
};
