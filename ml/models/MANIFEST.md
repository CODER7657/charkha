# Model manifest

Every model that has ever been used to make a decision, with its hash. The
verifier stamps this hash into the decision log, so this file is how you answer
"which model made that call".

| version | file | sha256 | trained | notes |
|---|---|---|---|---|
| 0.0.0-no-model | — | `0000…0000` (64 zeros) | — | stub mode: no .onnx found, every verdict is needs_review |
| 0.1.0-baseline | `ml/models/baseline-char-quality.onnx` | `e89f8a4722cbfad3bb7688f9b513c40c2037414086cc415622a506f297a789f1` | not trained | hand-set colour heuristic with the real model's exact I/O (1×3×224×224 → 3 probs, opset 17). Exists so both runtimes, the parity test and the field view run end to end before photos are labelled. **Not a char classifier** - dark = good, grey = poor, colourful = not char. |

When you export a fine-tuned model, add a row: version, file, the sha256 that
`export_onnx.py` prints, the date, the dataset size and validation accuracy
that `train.py` prints.
