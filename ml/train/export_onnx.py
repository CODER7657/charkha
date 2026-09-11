"""Export the fine-tuned char-quality classifier to ONNX.

OWNER: Hem

    python ml/train/export_onnx.py --checkpoint <ckpt> --out ml/models/char-quality.onnx

Remember to:
  - set dynamic_axes on the batch dimension
  - use a fixed opset so the web runtime agrees with the node runtime
  - print the SHA-256 of the written file and paste it into ml/models/MANIFEST.md
"""

import argparse
import hashlib
import pathlib


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--out", default="ml/models/char-quality.onnx")
    args = ap.parse_args()

    raise SystemExit("TODO(hem): load checkpoint, torch.onnx.export, then hash the file")


def sha256(path: str) -> str:
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


if __name__ == "__main__":
    main()
