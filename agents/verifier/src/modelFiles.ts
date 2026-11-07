import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * OWNER: Hem
 *
 * Where the one .onnx file lives. The verifier loads it and the web build
 * serves it, and both MUST resolve the same file - so both call this.
 *
 * First existing file wins:
 *   1. ONNX_MODEL_PATH, if set (relative paths resolve from the repo root,
 *      not from whichever package directory pnpm started us in)
 *   2. ml/models/char-quality.onnx - a locally trained export (gitignored)
 *   3. ml/models/baseline-char-quality.onnx - the committed colour baseline,
 *      so a fresh clone runs end to end without Python
 *
 * ONNX_MODEL_PATH is a preference, not the only option: .env.example points
 * it at the trained path, which does not exist until someone trains. Treating
 * it as final put every .env-based run (dev and compose) into stub mode while
 * CI, which has no .env, looked fine. A skipped configured path is reported in
 * `missing` so the caller can say so loudly; the hash in every decision still
 * records exactly which file ran.
 */

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export type ModelFiles = { onnx: string; sidecar: string; missing: string[] };

export const candidateModelPaths = (env: NodeJS.ProcessEnv = process.env): string[] => {
  const fromEnv = env["ONNX_MODEL_PATH"];
  const defaults = [
    path.join(REPO_ROOT, "ml/models/char-quality.onnx"),
    path.join(REPO_ROOT, "ml/models/baseline-char-quality.onnx"),
  ];
  return [...new Set(fromEnv ? [path.resolve(REPO_ROOT, fromEnv), ...defaults] : defaults)];
};

export const resolveModelFiles = (env: NodeJS.ProcessEnv = process.env): ModelFiles | null => {
  const candidates = candidateModelPaths(env);
  const index = candidates.findIndex((p) => existsSync(p));
  if (index === -1) return null;
  const onnx = candidates[index]!;
  // Only a configured path that was skipped is worth a warning; the untrained
  // default being absent is the normal state of a fresh clone.
  const missing = env["ONNX_MODEL_PATH"] && index > 0 ? [candidates[0]!] : [];
  return { onnx, sidecar: `${onnx}.json`, missing };
};
