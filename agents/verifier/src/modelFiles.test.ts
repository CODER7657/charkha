import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, resolveModelFiles } from "./modelFiles.ts";

const BASELINE = path.join(REPO_ROOT, "ml/models/baseline-char-quality.onnx");

describe("resolveModelFiles - verifier and web build must land on the same real file", () => {
  it("uses ONNX_MODEL_PATH when that file exists", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "charkha-model-"));
    const file = path.join(dir, "custom.onnx");
    writeFileSync(file, "x");
    const r = resolveModelFiles({ ONNX_MODEL_PATH: file });
    expect(r?.onnx).toBe(file);
    expect(r?.sidecar).toBe(`${file}.json`);
    expect(r?.missing).toEqual([]);
  });

  it("falls back to the committed baseline when ONNX_MODEL_PATH points at a model nobody has trained yet", () => {
    // Exactly what .env.example ships - and so every teammate's .env and the compose deployment.
    const r = resolveModelFiles({ ONNX_MODEL_PATH: "./ml/models/char-quality.onnx" });
    expect(r?.onnx).toBe(BASELINE);
    expect(r?.missing).toContain(path.join(REPO_ROOT, "ml/models/char-quality.onnx"));
  });

  it("resolves the baseline with no env at all, as CI does", () => {
    expect(resolveModelFiles({})?.onnx).toBe(BASELINE);
  });

  it("resolves relative env paths from the repo root, not the package directory", () => {
    const r = resolveModelFiles({ ONNX_MODEL_PATH: "ml/models/baseline-char-quality.onnx" });
    expect(r?.onnx).toBe(BASELINE);
    expect(r?.missing).toEqual([]);
  });
});
