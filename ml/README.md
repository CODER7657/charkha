# Model

OWNER: Hem

One `.onnx` file, two runtimes: `onnxruntime-node` in the verifier agent and
`onnxruntime-web` in the field view. Same artefact, same hash, same answer.

## Approach

Fine-tune a pretrained vision base — do **not** train from scratch, there is no
time and no need. Classes to aim for:

- `good_char` — well-formed biochar, dark, friable
- `poor_char` — under-pyrolysed, ashy, or contaminated
- `not_char` — anything else, including someone photographing their shoe

## Export

```bash
python ml/train/export_onnx.py --checkpoint <ckpt> --out ml/models/char-quality.onnx
```

Then record the SHA-256 in `ml/models/MANIFEST.md`. The verifier hashes the file
at boot and puts that hash in every decision record — that is how we prove which
model version made a given call.

## Non-negotiable

- The web build must load the model from the **same origin**, no CDN. Configure
  `ort.env.wasm.wasmPaths` to a local path so it works offline.
- Keep the input size small enough to run on a mid-range phone. If inference
  takes more than about two seconds on a real phone, shrink it.
- Add a fixture test that runs the same input through both runtimes and asserts
  they agree. If they diverge, stop and fix it — that divergence is the one
  thing that would make the whole verification story untrue.
