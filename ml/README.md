# Model

OWNER: Hem

One `.onnx` file, two runtimes: `onnxruntime-node` in the verifier agent and
`onnxruntime-web` in the field view. Same artefact, same hash, same answer.

## What runs today

`ml/models/baseline-char-quality.onnx` is committed: a hand-set colour heuristic
with the real model's exact inputs and outputs. It is **not** a char classifier -
it exists so the whole pipeline works from a clean clone. See `MANIFEST.md`.

The verifier and the web build resolve the model the same way
(`agents/verifier/src/modelFiles.ts`):

1. `ONNX_MODEL_PATH`, if set
2. `ml/models/char-quality.onnx` - your fine-tuned export (gitignored)
3. `ml/models/baseline-char-quality.onnx` - the committed baseline

## The contract every model must keep

Defined in `ml/train/charmodel.py`, mirrored in `agents/verifier/src/protocol.ts`:

- input `input`: float32 `[N, 3, 224, 224]`, RGB, ImageNet mean/std normalised
- output `probs`: float32 `[N, 3]`, softmax **inside the graph**, order
  `good_char, poor_char, not_char`
- opset 17, dynamic batch axis only

## Fine-tune

```bash
pip install -r ml/train/requirements.txt
```

Put photos in one folder per class (any image format):

```
ml/data/good_char/   well-formed biochar, dark, friable
ml/data/poor_char/   under-pyrolysed, ashy, or contaminated
ml/data/not_char/    anything else - soil, straw, hands, shoes, the kiln
```

```bash
python ml/train/train.py --data ml/data --out ml/checkpoints/char-quality.pt
python ml/train/export_onnx.py --checkpoint ml/checkpoints/char-quality.pt \
    --version 1.0.0 --out ml/models/char-quality.onnx
```

MobileNetV3-small, ImageNet-pretrained: head only for a few epochs, then the
whole network. `export_onnx.py` re-runs the export through Python onnxruntime,
compares it with torch, writes a `.json` sidecar (version + sha256), and prints
the hash - **add it to `MANIFEST.md`**. Restart the verifier; the web dev server
picks the new file up without a restart.

## The parity guarantee

`agents/verifier/src/parity.test.ts` runs the committed baseline through Python
onnxruntime (expected values in `agents/verifier/test/fixtures/parity.json`),
`onnxruntime-node` and `onnxruntime-web`, and fails if any of them disagree.
Regenerate the fixture only when the baseline itself changes:

```bash
python ml/train/export_onnx.py --baseline --version 0.1.0-baseline \
    --out ml/models/baseline-char-quality.onnx \
    --fixture agents/verifier/test/fixtures/parity.json
```

At runtime the same guarantee is checked per submission: the browser also scores
a pseudo-random **canary** tensor seeded from the image hash, and the verifier
re-runs it with onnxruntime-node. Divergence → `needs_review`.

## Testing on a phone

`crypto.subtle` (image hashing) and the camera only work in a **secure context**
- `https://` or `localhost`. Plain `http://192.168.x.x:5173` will not work. Either:

- **USB (Android):** `adb reverse tcp:5173 tcp:5173`, then open
  `http://localhost:5173/#field` in Chrome on the phone. Works with wifi off.
- **Demo host:** the Caddy deployment serves HTTPS, open `/#field`.

Load the page while online (the model and the ~26 MB wasm, ~6 MB gzipped, are
fetched once), then turn wifi off: capture and inference still work, and
submissions queue in `localStorage` until the network returns.

## Non-negotiable

- The model and wasm load from the **same origin** (`/models`, `/ort`), no CDN.
- If inference takes more than about two seconds on a real phone, shrink the
  input size (both `charmodel.py` and `protocol.ts`) before anything else.
- If the parity test fails, stop and fix it - that divergence is the one thing
  that would make the whole verification story untrue.
