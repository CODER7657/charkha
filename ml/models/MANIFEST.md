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

---

# Saathi intent embedding (Tier 2)

Not a decision model - it never appears in the ledger, and no credit depends on
it. It ranks which of eight intents a sentence most resembles, and the answer
is always checkable against the sentence itself.

**The bytes are deliberately not in this repo.** 129 MB in git is permanent, and
the Dockerfile copies `ml/`, so every deploy would carry it on a host where the
redeploy window is already the riskiest minute we have. The files are mounted on
the VM as a volume, the way `firmscache` is. A clean clone still works: with no
model the resolver runs Tier 1, which is what ships today.

| file | bytes | sha256 |
|---|---|---|
| `model_quantized.onnx` | 118,308,126 | `66fc00f5f29afcaff34092e1bdd20008ca3918265a82fb9695a551e510cc4ebc` |
| `tokenizer.json` | 17,082,913 | `b60b6b43406a48bf3638526314f3d232d97058bc93472ff2de930d43686fa441` |
| `tokenizer_config.json` | 496 | `3f5961b9ac86288cccdb97f32fb848d6187c78e1603958c53f3ea1f296b7d8a2` |

Source: `Xenova/paraphrase-multilingual-MiniLM-L12-v2`, int8 quantised, 384
dimensions. Sentence-transformers, Apache-2.0, XLM-R tokenizer.

```
ASSISTANT_EMBED=1
ASSISTANT_EMBED_MODEL=/models/model_quantized.onnx
ASSISTANT_EMBED_TOKENIZER=/models/tokenizer.json
```

`tokenizer_config.json` is read from beside `tokenizer.json`, so it needs no
variable of its own. Any of these missing, unset, or unreadable means Tier 1 -
silently, by design.

## Measured, on this machine, `onnxruntime-node@1.29.0`

| | |
|---|---|
| model load | 973-1085 ms, once at startup |
| per sentence | 2-5 ms steady state (107 ms on the first call, which warms the prototypes) |
| gibberish | 0-1 ms - the fertility guard refuses before any inference |
| held-out corpus | **18 of 20**, **0 confidently wrong** |
| tokenizer coverage | `unk=0` on Devanagari, Gurmukhi and Gujarati |

The two misses are abstentions, not wrong answers. That is the intended trade:
Tier 1 answers or refuses honestly, which beats a confident wrong intent.

## What it is not

Accuracy here is measured against a twenty-sentence corpus written by one
person in one sitting. It is a smoke test, not a benchmark, and the prototype
examples matter more than the model does - the worst result in the whole spike

    sim=0.93   ਸਾਨੂੰ ਦੱਸੋ ਇਹ ਸਭ ਕਿਵੇਂ ਹੁੰਦਾ ਹੈ  ->  lot_status  (wanted how_it_works)

was caused by a missing Punjabi prototype, not by the model. Prototype coverage
per intent **per language** is where the remaining risk sits.
