"""Shared definitions for the char-quality classifier.

OWNER: Hem

Everything the browser, the verifier agent and the training scripts must agree
on lives here and is mirrored, value for value, in
`agents/verifier/src/protocol.ts`. The parity fixture pins the two together:
if you change a value here, regenerate the fixture and update protocol.ts in
the same commit.
"""

from __future__ import annotations

import torch
from torch import nn

# Order matters: it is the order of the model's output vector.
CLASSES = ["good_char", "poor_char", "not_char"]

# 224 keeps MobileNetV3-small well under the ~2 s budget on a mid-range phone
# (wasm, single thread). Shrink this before touching anything else if a real
# phone is slow.
INPUT_SIZE = 224

# ImageNet statistics - the pretrained backbone was trained with these.
MEAN = [0.485, 0.456, 0.406]
STD = [0.229, 0.224, 0.225]

# Fixed so onnxruntime-node and onnxruntime-web see the same operator set.
OPSET = 17

INPUT_NAME = "input"
OUTPUT_NAME = "probs"


class WithSoftmax(nn.Module):
    """Bake softmax into the graph so no runtime re-implements it in JS."""

    def __init__(self, logits_model: nn.Module) -> None:
        super().__init__()
        self.logits_model = logits_model

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return torch.softmax(self.logits_model(x), dim=1)


def build_finetune_model(pretrained: bool) -> nn.Module:
    """MobileNetV3-small with a fresh 3-class head. Outputs logits."""
    from torchvision.models import MobileNet_V3_Small_Weights, mobilenet_v3_small

    weights = MobileNet_V3_Small_Weights.IMAGENET1K_V1 if pretrained else None
    model = mobilenet_v3_small(weights=weights)
    last = model.classifier[-1]
    assert isinstance(last, nn.Linear)
    model.classifier[-1] = nn.Linear(last.in_features, len(CLASSES))
    return model


class BaselineColourModel(nn.Module):
    """A hand-set, untrained colour heuristic with the real model's exact I/O.

    It exists so the whole pipeline (two runtimes, parity test, field view,
    verifier) runs end to end before any photos are labelled. It is NOT a
    char classifier and the manifest says so.

      lum    = mean pixel brightness in [0, 1]
      chroma = mean over pixels of (max channel - min channel)

      good_char <- dark and colourless  (charcoal black)
      poor_char <- mid grey, colourless (ashy / under-pyrolysed)
      not_char  <- anything colourful or bright
    """

    def __init__(self) -> None:
        super().__init__()
        self.register_buffer("mean", torch.tensor(MEAN).view(1, 3, 1, 1))
        self.register_buffer("std", torch.tensor(STD).view(1, 3, 1, 1))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        rgb = x * self.std + self.mean  # undo ImageNet normalisation
        lum = rgb.mean(dim=(1, 2, 3))
        chroma = (rgb.amax(dim=1) - rgb.amin(dim=1)).mean(dim=(1, 2))
        good = 10.0 * (0.30 - lum) - 12.0 * chroma
        poor = 2.0 - 12.0 * torch.abs(lum - 0.50) - 12.0 * chroma
        not_char = 16.0 * (chroma - 0.10) + 6.0 * (lum - 0.80)
        return torch.stack([good, poor, not_char], dim=1)


def canary_tensor(image_hash: str) -> torch.Tensor:
    """Deterministic pseudo-random input seeded from a SHA-256 hex digest.

    Mirrors `canaryTensor()` in agents/verifier/src/protocol.ts bit for bit:
    xorshift32 seeded from an FNV-1a fold of the digest's eight 32-bit words, each
    value (x >>> 8) / 2^24 * 4 - 2, which is exactly representable in float32.
    """
    if len(image_hash) != 64:
        raise ValueError("image_hash must be 64 hex chars")
    state = 0x811C9DC5  # FNV-1a fold of the eight words: order-sensitive, unlike XOR
    for i in range(0, 64, 8):
        state = ((state ^ int(image_hash[i : i + 8], 16)) * 0x01000193) & 0xFFFFFFFF
    if state == 0:
        state = 0x9E3779B9
    n = 3 * INPUT_SIZE * INPUT_SIZE
    out = [0.0] * n
    for i in range(n):
        state ^= (state << 13) & 0xFFFFFFFF
        state ^= state >> 17
        state ^= (state << 5) & 0xFFFFFFFF
        out[i] = ((state >> 8) / 16777216.0) * 4.0 - 2.0
    return torch.tensor(out, dtype=torch.float32).view(1, 3, INPUT_SIZE, INPUT_SIZE)
