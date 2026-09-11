import { useState } from "react";

/**
 * OWNER: Hem
 *
 * The privacy beat, and the one that must work with the wifi switched off.
 *
 * HARD RULE: the photo never leaves the device. You run the classifier here,
 * in the browser, with onnxruntime-web, and submit ONLY:
 *   { imageHash, modelHash, modelVersion, clientScores, gps, batch params }
 * If you ever find yourself putting a base64 image in the request body, stop.
 *
 * BUILD
 *  - a file input with accept="image/*" and capture="environment" so a phone
 *    opens the camera directly
 *  - draw to a canvas, resize to the model input size, normalise to a
 *    Float32Array in NCHW, run ort.InferenceSession
 *  - load the .onnx with ort.env.wasm paths pointed at same-origin assets so
 *    it works offline; try WebGPU and fall back to wasm, and SAY which one
 *    ran in the UI - judges like seeing that
 *  - SHA-256 the raw image bytes with crypto.subtle.digest for imageHash
 *  - show the top-3 class scores and the model hash on screen before submit
 *  - a batch-params form: peak temp, residence time, feedstock, output tonnes,
 *    optional H/C ratio
 *  - an offline queue: if POST /api/evidence fails, hold it in localStorage
 *    and retry. Demo it by turning wifi off mid-capture.
 *
 * Test on an actual phone browser well before hour 30, not at hour 35.
 */
export const FieldCapture = () => {
  const [status, setStatus] = useState("ready");

  return (
    <div className="view">
      <div className="view-head">
        <h1>Field capture</h1>
        <p>Inference runs on this device. The photo is never uploaded, only its hash and the scores.</p>
      </div>
      <div className="placeholder">TODO(hem): camera + onnxruntime-web + batch form + offline queue</div>
      <p className="muted">{status}</p>
      <button onClick={() => setStatus("TODO(hem): wire up capture")}>Capture evidence</button>
    </div>
  );
};
