import * as ort from "onnxruntime-web/webgpu";
import {
  INPUT_DIMS,
  INPUT_SIZE,
  canaryTensor,
  rgbaToNchw,
  toClassScores,
  type ClassScores,
  type ModelSidecar,
} from "../../../../../agents/verifier/src/protocol.ts";
import { memoizeAsync, serialized } from "./serial.ts";

/**
 * OWNER: Hem
 *
 * On-device inference. Everything this file fetches is same-origin - the
 * model from /models, the wasm from /ort - so once the page has loaded, the
 * wifi can go and inference still runs. No CDN, ever.
 *
 * The protocol (classes, preprocessing, canary) is imported from the
 * verifier so the browser and the server cannot drift apart.
 */

export const MODEL_URL = "/models/char-quality.onnx";

// Same-origin wasm. Served by the vite plugin in dev, copied into dist on build.
ort.env.wasm.wasmPaths = "/ort/";
// Threads need cross-origin isolation, which we do not set; say so up front
// instead of letting ort discover it and warn.
ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? 0 : 1;

export type Backend = "webgpu" | "wasm";

export type FieldModel = {
  version: string;
  hash: string;
  backend: Backend;
  /** Why a preferred backend was skipped, shown in the UI. */
  fallbacks: string[];
  run: (input: Float32Array) => Promise<ClassScores>;
};

export const sha256Hex = async (bytes: ArrayBuffer | Uint8Array): Promise<string> => {
  if (!globalThis.crypto?.subtle) {
    throw new Error("crypto.subtle is unavailable - open the page over https or localhost (see ml/README.md, phone testing)");
  }
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
};

const fetchOk = async (url: string): Promise<Response> => {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res;
};

/** Every call into ort goes through here - see serial.ts for why. */
const inOrt = serialized();

/**
 * Load the model once per page, however many times the view mounts: hash the
 * exact bytes, then try WebGPU, fall back to wasm.
 */
export const loadFieldModel = memoizeAsync(async (): Promise<FieldModel> => {
  const bytes = new Uint8Array(await (await fetchOk(MODEL_URL)).arrayBuffer());
  const hash = await sha256Hex(bytes);

  let version = "unmanifested";
  try {
    const meta = (await (await fetchOk(`${MODEL_URL}.json`)).json()) as ModelSidecar;
    if (meta.sha256 === hash) version = meta.version;
  } catch {
    /* no sidecar - the hash still identifies the model */
  }

  const backends: Backend[] = "gpu" in navigator ? ["webgpu", "wasm"] : ["wasm"];
  const fallbacks: string[] = [];
  for (const backend of backends) {
    let session: ort.InferenceSession | null = null;
    try {
      session = await inOrt(() => ort.InferenceSession.create(bytes, { executionProviders: [backend] }));
      const s = session;
      const run = (input: Float32Array) =>
        inOrt(async () => {
          const out = await s.run({ [s.inputNames[0]!]: new ort.Tensor("float32", input, [...INPUT_DIMS]) });
          return toClassScores(out[s.outputNames[0]!]!.data as Float32Array);
        });
      // A WebGPU adapter can exist and still fail on first run - prove it works.
      await run(canaryTensor("0".repeat(63) + "1"));
      return { version, hash, backend, fallbacks, run };
    } catch (err) {
      fallbacks.push(`${backend} unavailable: ${err instanceof Error ? err.message : String(err)}`);
      if (session) await inOrt(() => session!.release()).catch(() => undefined);
    }
  }
  throw new Error(`could not start onnxruntime-web (${fallbacks.join("; ")})`);
});

/**
 * Photo -> NCHW tensor. Plain resize to INPUT_SIZE square, no crop: this is
 * the validation transform the model was trained against.
 */
export const imageToTensor = async (file: Blob, canvas: HTMLCanvasElement): Promise<Float32Array> => {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  canvas.width = INPUT_SIZE;
  canvas.height = INPUT_SIZE;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  if (!g) throw new Error("canvas 2d context unavailable");
  g.drawImage(bitmap, 0, 0, INPUT_SIZE, INPUT_SIZE);
  bitmap.close();
  const { data } = g.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  return rgbaToNchw(data, INPUT_SIZE, INPUT_SIZE);
};
