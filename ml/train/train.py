"""Fine-tune MobileNetV3-small on labelled char photos.

OWNER: Hem

    python ml/train/train.py --data ml/data --out ml/checkpoints/char-quality.pt

Layout (torchvision ImageFolder, one folder per class, any image format):

    ml/data/good_char/*.jpg
    ml/data/poor_char/*.jpg
    ml/data/not_char/*.jpg

A stratified validation split is carved off automatically. Then export:

    python ml/train/export_onnx.py --checkpoint ml/checkpoints/char-quality.pt \
        --version 1.0.0 --out ml/models/char-quality.onnx

Two phases: the head alone for a few epochs (the pretrained features are
already good), then the whole network at a lower learning rate.
"""

from __future__ import annotations

import argparse
import pathlib
import random
import sys

import torch
from torch import nn
from torch.utils.data import DataLoader, Subset

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from charmodel import CLASSES, INPUT_SIZE, MEAN, STD, build_finetune_model  # noqa: E402


def transforms(train: bool):
    from torchvision import transforms as T

    if train:
        return T.Compose([
            T.RandomResizedCrop(INPUT_SIZE, scale=(0.6, 1.0)),
            T.RandomHorizontalFlip(),
            T.RandomRotation(15),
            # Field photos vary wildly in light; do not vary hue, colour is signal.
            T.ColorJitter(brightness=0.25, contrast=0.25),
            T.ToTensor(),
            T.Normalize(MEAN, STD),
        ])
    # Matches the browser: plain resize to INPUT_SIZE x INPUT_SIZE, no crop.
    return T.Compose([T.Resize((INPUT_SIZE, INPUT_SIZE)), T.ToTensor(), T.Normalize(MEAN, STD)])


def split(targets: list[int], val_fraction: float, seed: int) -> tuple[list[int], list[int]]:
    rng = random.Random(seed)
    train_idx, val_idx = [], []
    for cls in set(targets):
        idx = [i for i, t in enumerate(targets) if t == cls]
        rng.shuffle(idx)
        n_val = max(1, round(len(idx) * val_fraction))
        val_idx += idx[:n_val]
        train_idx += idx[n_val:]
    return train_idx, val_idx


def evaluate(model: nn.Module, loader: DataLoader, device: str) -> float:
    model.eval()
    correct = total = 0
    with torch.no_grad():
        for x, y in loader:
            pred = model(x.to(device)).argmax(dim=1).cpu()
            correct += int((pred == y).sum())
            total += len(y)
    return correct / max(1, total)


def main() -> None:
    from torchvision.datasets import ImageFolder

    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="ml/data")
    ap.add_argument("--out", default="ml/checkpoints/char-quality.pt")
    ap.add_argument("--head-epochs", type=int, default=4)
    ap.add_argument("--full-epochs", type=int, default=8)
    ap.add_argument("--batch-size", type=int, default=32)
    ap.add_argument("--val-fraction", type=float, default=0.2)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--no-pretrained", action="store_true", help="smoke-test only, skips the weight download")
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    device = "cuda" if torch.cuda.is_available() else "cpu"

    probe = ImageFolder(args.data)
    if probe.classes != sorted(CLASSES):
        raise SystemExit(f"expected class folders {sorted(CLASSES)}, found {probe.classes}")
    # ImageFolder sorts folders alphabetically; remap to CLASSES order so output
    # index i always means CLASSES[i], in every runtime.
    remap = {probe.class_to_idx[c]: CLASSES.index(c) for c in CLASSES}
    train_ds = ImageFolder(args.data, transform=transforms(True), target_transform=remap.__getitem__)
    val_ds = ImageFolder(args.data, transform=transforms(False), target_transform=remap.__getitem__)

    train_idx, val_idx = split([remap[t] for t in probe.targets], args.val_fraction, args.seed)
    train_loader = DataLoader(Subset(train_ds, train_idx), batch_size=args.batch_size, shuffle=True, num_workers=2)
    val_loader = DataLoader(Subset(val_ds, val_idx), batch_size=args.batch_size, num_workers=2)
    print(f"{len(train_idx)} train / {len(val_idx)} val images on {device}")

    model = build_finetune_model(pretrained=not args.no_pretrained).to(device)
    loss_fn = nn.CrossEntropyLoss(label_smoothing=0.05)
    best = -1.0
    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    phases = [("head", args.head_epochs, 1e-3, model.classifier.parameters()),
              ("full", args.full_epochs, 1e-4, model.parameters())]
    for phase, epochs, lr, params in phases:
        for p in model.parameters():
            p.requires_grad = phase == "full"
        for p in model.classifier.parameters():
            p.requires_grad = True
        opt = torch.optim.AdamW([p for p in params if p.requires_grad], lr=lr, weight_decay=1e-4)
        for epoch in range(epochs):
            model.train()
            for x, y in train_loader:
                opt.zero_grad()
                loss = loss_fn(model(x.to(device)), y.to(device))
                loss.backward()
                opt.step()
            acc = evaluate(model, val_loader, device)
            print(f"[{phase} {epoch + 1}/{epochs}] loss {loss.item():.3f} val acc {acc:.3f}")
            if acc > best:
                best = acc
                torch.save({"model": model.state_dict(), "classes": CLASSES, "valAcc": acc}, out)

    print(f"best val acc {best:.3f} -> {out}")


if __name__ == "__main__":
    main()
