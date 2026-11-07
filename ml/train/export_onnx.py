"""Export the char-quality classifier to ONNX.

OWNER: Hem

    # the fine-tuned model (checkpoint written by train.py)
    python ml/train/export_onnx.py --checkpoint ml/checkpoints/char-quality.pt \
        --version 1.0.0 --out ml/models/char-quality.onnx

    # the hand-set colour baseline, no checkpoint needed
    python ml/train/export_onnx.py --baseline --version 0.1.0-baseline \
        --out ml/models/char-quality.onnx

What this guarantees:
  - fixed opset (charmodel.OPSET) so onnxruntime-web and onnxruntime-node agree
  - dynamic_axes on the batch dimension only
  - softmax baked into the graph, output is probabilities in CLASSES order
  - a sidecar `<out>.json` with version, sha256, classes and preprocessing,
    read by both the verifier and the field view
  - the exported file is re-run through Python onnxruntime and compared with
    torch before we trust it
  - SHA-256 printed at the end: paste it into ml/models/MANIFEST.md

`--fixture` additionally writes a parity fixture (inputs + expected scores)
that the TypeScript parity test replays through both JS runtimes.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import pathlib
import sys

import numpy as np
import torch

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from charmodel import (  # noqa: E402
    CLASSES,
    INPUT_NAME,
    INPUT_SIZE,
    MEAN,
    OPSET,
    OUTPUT_NAME,
    STD,
    BaselineColourModel,
    WithSoftmax,
    build_finetune_model,
    canary_tensor,
)

# Hashes the parity fixture pins. Arbitrary but fixed.
FIXTURE_HASHES = [
    "0" * 63 + "1",
    "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
]


def sha256(path: str | pathlib.Path) -> str:
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


def solid_image(rgb: tuple[float, float, float]) -> torch.Tensor:
    """A flat colour, already ImageNet-normalised, as the browser would send it."""
    t = torch.empty(1, 3, INPUT_SIZE, INPUT_SIZE)
    for c in range(3):
        t[:, c] = (rgb[c] - MEAN[c]) / STD[c]
    return t


def load_model(args: argparse.Namespace) -> torch.nn.Module:
    if args.baseline:
        return WithSoftmax(BaselineColourModel()).eval()
    model = build_finetune_model(pretrained=False)
    state = torch.load(args.checkpoint, map_location="cpu", weights_only=True)
    model.load_state_dict(state["model"] if "model" in state else state)
    return WithSoftmax(model).eval()


def export(model: torch.nn.Module, out: pathlib.Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        model,
        (torch.zeros(1, 3, INPUT_SIZE, INPUT_SIZE),),
        str(out),
        dynamo=False,
        opset_version=OPSET,
        input_names=[INPUT_NAME],
        output_names=[OUTPUT_NAME],
        dynamic_axes={INPUT_NAME: {0: "batch"}, OUTPUT_NAME: {0: "batch"}},
    )


def check_against_torch(model: torch.nn.Module, out: pathlib.Path) -> list[dict]:
    """Run fixture inputs through torch and Python onnxruntime; they must agree."""
    import onnxruntime as ort

    session = ort.InferenceSession(str(out), providers=["CPUExecutionProvider"])
    cases: list[tuple[str, torch.Tensor]] = [
        (f"canary:{h}", canary_tensor(h)) for h in FIXTURE_HASHES
    ]
    cases += [
        ("solid:black", solid_image((0.05, 0.05, 0.05))),
        ("solid:grey", solid_image((0.55, 0.55, 0.55))),
        ("solid:green", solid_image((0.20, 0.70, 0.20))),
    ]
    results = []
    for name, x in cases:
        with torch.no_grad():
            expected = model(x).numpy()[0]
        got = session.run([OUTPUT_NAME], {INPUT_NAME: x.numpy()})[0][0]
        diff = float(np.max(np.abs(expected - got)))
        if diff > 1e-4:
            raise SystemExit(f"torch and onnxruntime disagree on {name}: max diff {diff}")
        results.append({"name": name, "input": x, "scores": dict(zip(CLASSES, map(float, got)))})
    return results


def write_fixture(path: pathlib.Path, model_file: pathlib.Path, cases: list[dict]) -> None:
    """Solid images are described, not stored: the TS test rebuilds them."""
    fixture = {
        "model": model_file.as_posix(),  # repo-relative, as passed on the command line
        "sha256": sha256(model_file),
        "tolerance": 1e-4,
        "cases": [],
    }
    for c in cases:
        entry = {"name": c["name"], "scores": c["scores"]}
        # Pin the canary bytes too, so a drift in the TS generator is caught
        # separately from a drift in the runtimes.
        entry["inputSha256"] = hashlib.sha256(c["input"].numpy().astype("<f4").tobytes()).hexdigest()
        fixture["cases"].append(entry)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(fixture, indent=2) + "\n")


def main() -> None:
    ap = argparse.ArgumentParser()
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--checkpoint", help="state_dict written by train.py")
    src.add_argument("--baseline", action="store_true", help="export the hand-set colour baseline")
    ap.add_argument("--out", default="ml/models/char-quality.onnx")
    ap.add_argument("--version", required=True, help="semver, recorded in MANIFEST.md and every decision")
    ap.add_argument("--fixture", help="also write a parity fixture JSON to this path")
    args = ap.parse_args()

    out = pathlib.Path(args.out)
    model = load_model(args)
    export(model, out)
    cases = check_against_torch(model, out)
    digest = sha256(out)

    sidecar = {
        "version": args.version,
        "sha256": digest,
        "classes": CLASSES,
        "inputName": INPUT_NAME,
        "outputName": OUTPUT_NAME,
        "inputSize": INPUT_SIZE,
        "mean": MEAN,
        "std": STD,
        "opset": OPSET,
        "kind": "baseline-colour-heuristic" if args.baseline else "mobilenet_v3_small-finetuned",
        "exportedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
    }
    out.with_suffix(out.suffix + ".json").write_text(json.dumps(sidecar, indent=2) + "\n")

    if args.fixture:
        write_fixture(pathlib.Path(args.fixture), out, cases)

    print(f"wrote {out} ({out.stat().st_size} bytes)")
    for c in cases:
        top = max(c["scores"], key=c["scores"].get)
        print(f"  {c['name'][:24]:<24} -> {top}")
    print(f"sha256 {digest}")
    print("paste that hash into ml/models/MANIFEST.md")


if __name__ == "__main__":
    main()
