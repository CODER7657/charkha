import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { defaultClientConditions, defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolveModelFiles } from "../../agents/verifier/src/modelFiles.ts";

/**
 * Field view assets, served from THIS origin so inference survives the wifi
 * going off (no CDN - see CLAUDE.md rule 4):
 *   /models/char-quality.onnx(.json) - the same file the verifier loads
 *   /ort/*.wasm                       - onnxruntime-web's runtime
 * Resolved on every request in dev, so re-exporting the model needs no restart.
 */
const ORT_DIST = path.dirname(createRequire(import.meta.url).resolve("onnxruntime-web")); // .../onnxruntime-web/dist
// onnxruntime-web/webgpu runs both its WebGPU and wasm backends on this binary.
const ORT_FILES = ["ort-wasm-simd-threaded.asyncify.wasm", "ort-wasm-simd-threaded.asyncify.mjs"];

const fieldAssets = (): Record<string, string> => {
  const out: Record<string, string> = {};
  const model = resolveModelFiles();
  if (model) {
    out["models/char-quality.onnx"] = model.onnx;
    if (existsSync(model.sidecar)) out["models/char-quality.onnx.json"] = model.sidecar;
  }
  for (const f of ORT_FILES) out[`ort/${f}`] = path.join(ORT_DIST, f);
  return out;
};

const TYPES: Record<string, string> = {
  ".onnx": "application/octet-stream",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".mjs": "text/javascript",
};

const fieldAssetsPlugin = (): Plugin => ({
  name: "charkha-field-assets",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = (req.url ?? "").split("?")[0]!.replace(/^\//, "");
      const file = fieldAssets()[url];
      if (!file) return next();
      res.setHeader("content-type", TYPES[path.extname(file)] ?? "application/octet-stream");
      res.setHeader("cache-control", "no-cache");
      createReadStream(file).pipe(res);
    });
  },
  generateBundle() {
    const assets = fieldAssets();
    if (!assets["models/char-quality.onnx"]) this.warn("no .onnx model found - the field view will show a load error");
    for (const [fileName, file] of Object.entries(assets)) {
      this.emitFile({ type: "asset", fileName, source: readFileSync(file) });
    }
  },
});

export default defineConfig({
  plugins: [react(), fieldAssetsPlugin()],
  server: {
    // IPv4 on purpose. On Windows "localhost" binds only [::1], and
    // `adb reverse` (phone testing, see ml/README.md) delivers to 127.0.0.1,
    // so the phone got "site can't be reached". Desktop browsers try both.
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": "http://localhost:4000" },
  },
  // Pick onnxruntime-web's build that loads its wasm + glue from wasmPaths
  // (/ort/) instead of bundling a second 25 MB copy under /assets.
  resolve: { conditions: ["onnxruntime-web-use-extern-wasm", ...defaultClientConditions] },
  // ort locates its wasm at runtime via wasmPaths; pre-bundling breaks that.
  optimizeDeps: { exclude: ["onnxruntime-web"] },
  build: { outDir: "dist", sourcemap: true },
});
