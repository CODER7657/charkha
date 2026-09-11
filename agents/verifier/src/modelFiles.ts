import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * OWNER: Hem
 *
 * Where the one .onnx file lives. The verifier loads it and the web build
 * serves it, and both MUST resolve the same file - so both call this.
 *
 * Order:
 *   1. ONNX_MODEL_PATH, if set (relative paths resolve from the repo root,
 *      not from whichever package directory pnpm started us in)
 *   2. ml/models/char-quality.onnx - a locally trained export (gitignored)
 *   3. ml/models/baseline/char-quality.onnx - the committed colour baseline,
 *      so a fresh clone runs end to end without Python
 */

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export type ModelFiles = { onnx: string; sidecar: string };

export const candidateModelPaths = (env: NodeJS.ProcessEnv = process.env): string[] => {
  const fromEnv = env["ONNX_MODEL_PATH"];
  if (fromEnv) return [path.resolve(REPO_ROOT, fromEnv)];
  return [
    path.join(REPO_ROOT, "ml/models/char-quality.onnx"),
    path.join(REPO_ROOT, "ml/models/baseline/char-quality.onnx"),
  ];
};

export const resolveModelFiles = (env: NodeJS.ProcessEnv = process.env): ModelFiles | null => {
  const onnx = candidateModelPaths(env).find((p) => existsSync(p));
  return onnx ? { onnx, sidecar: `${onnx}.json` } : null;
};
