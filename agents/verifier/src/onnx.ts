import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as ort from "onnxruntime-node";
import { resolveModelFiles } from "./modelFiles.ts";
import { CLASSES, INPUT_DIMS, toClassScores, type ClassScores, type ModelSidecar } from "./protocol.ts";

/**
 * OWNER: Hem
 *
 * Load the ONNX model once at boot and hash the file. The hash goes into
 * every decision record - that is how we prove which model version made a
 * given call.
 *
 * The SAME .onnx file is served to the browser and run with onnxruntime-web
 * in the field view: one artefact, two runtimes. parity.test.ts pins them.
 */

export const NO_MODEL_HASH = "0".repeat(64);

export type LoadedModel = {
  version: string;
  hash: string;
  /** false in stub mode: no model file was found, `run` must not be trusted. */
  loaded: boolean;
  /** One NCHW float32 image of INPUT_DIMS -> probabilities per class. */
  run: (input: Float32Array) => Promise<ClassScores>;
};

let model: LoadedModel | null = null;

/** Open one specific file. Exported for tests; the agent uses loadModel(). */
export const openModel = async (onnxPath: string, sidecarPath = `${onnxPath}.json`): Promise<LoadedModel> => {
  const bytes = await readFile(onnxPath);
  const hash = createHash("sha256").update(bytes).digest("hex");
  // Create from the exact bytes we hashed, so the hash describes what runs.
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ["cpu"] });

  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  if (!inputName || !outputName) throw new Error(`${onnxPath}: model has no input or output`);

  const version = await readVersion(sidecarPath, hash);

  return {
    version,
    hash,
    loaded: true,
    run: async (input) => {
      const expected = INPUT_DIMS.reduce<number>((a, b) => a * b, 1);
      if (input.length !== expected) throw new Error(`model input must have ${expected} values, got ${input.length}`);
      const feeds = { [inputName]: new ort.Tensor("float32", input, [...INPUT_DIMS]) };
      const out = await session.run(feeds);
      const probs = out[outputName];
      if (!probs) throw new Error(`model produced no "${outputName}" output`);
      return toClassScores(probs.data as Float32Array);
    },
  };
};

/**
 * The sidecar carries the human version string. If its recorded hash does not
 * match the file, the sidecar is stale and we refuse to borrow its version -
 * the hash is the truth, a wrong version label would be worse than none.
 */
const readVersion = async (sidecarPath: string, hash: string): Promise<string> => {
  try {
    const meta = JSON.parse(await readFile(sidecarPath, "utf8")) as Partial<ModelSidecar>;
    if (meta.sha256 !== hash) {
      console.warn(`[verifier] ${sidecarPath} describes a different file (sha256 mismatch) - ignoring its version`);
      return "unmanifested";
    }
    if (JSON.stringify(meta.classes) !== JSON.stringify(CLASSES)) {
      throw new Error(`model classes ${JSON.stringify(meta.classes)} do not match protocol ${JSON.stringify(CLASSES)}`);
    }
    return meta.version ?? "unmanifested";
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("model classes")) throw err;
    return process.env["ONNX_MODEL_VERSION"] ?? "unmanifested";
  }
};

const stubModel = (): LoadedModel => ({
  version: "0.0.0-no-model",
  hash: NO_MODEL_HASH,
  loaded: false,
  run: async () => {
    throw new Error("no model loaded");
  },
});

export const loadModel = async (): Promise<LoadedModel> => {
  if (model) return model;
  const files = resolveModelFiles();
  if (!files) {
    // Model not exported yet - do not crash the mesh, just be honest about it.
    console.warn("[verifier] no .onnx model found - running in stub mode, every verdict will be needs_review");
    model = stubModel();
    return model;
  }
  try {
    model = await openModel(files.onnx, files.sidecar);
    console.log(`[verifier] model ${model.version} sha256=${model.hash} from ${files.onnx}`);
  } catch (err) {
    console.warn(`[verifier] could not load ${files.onnx}: ${err instanceof Error ? err.message : err} - stub mode`);
    model = stubModel();
  }
  return model;
};

export const getModel = (): LoadedModel => {
  if (!model) throw new Error("model not loaded - call loadModel() at boot");
  return model;
};
