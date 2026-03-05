"""
Training script for SiamMask-Lite.

Training strategy (3 phases):

Phase 1 — Pre-training on YouTube-VOS + DAVIS (general VOS capability)
    - 50 epochs, LR=1e-3, batch_size=32
    - Backbone LR = 0.1x (slower backbone learning)
    - Full augmentation pipeline
    - Teaches the model to match + segment arbitrary objects

Phase 2 — Fine-tuning on YOLO bbox pseudo-masks (domain adaptation)
    - 30 epochs, LR=1e-4, batch_size=16
    - Mix 70% rocket data + 30% VOS data (prevent forgetting)
    - Backbone frozen for first 10 epochs, then unfrozen at 0.01x LR

Phase 3 — Fine-tuning on real mask annotations (precision refinement)
    - 20 epochs, LR=5e-5, batch_size=8
    - Only rocket footage with pixel-perfect masks
    - Focus on mask quality (increase mask loss weight)

Usage:
    python -m siammask.training.train \
        --phase 1 \
        --vos-root data/youtube-vos/train data/DAVIS/trainval \
        --epochs 50 \
        --batch-size 32 \
        --lr 1e-3

    python -m siammask.training.train \
        --phase 2 \
        --checkpoint checkpoints/phase1_best.pth \
        --yolo-images data/rockets/images/train \
        --yolo-labels data/rockets/labels/train \
        --vos-root data/youtube-vos/train \
        --epochs 30 \
        --batch-size 16 \
        --lr 1e-4

    python -m siammask.training.train \
        --phase 3 \
        --checkpoint checkpoints/phase2_best.pth \
        --vos-root data/rockets-masks/train \
        --epochs 20 \
        --batch-size 8 \
        --lr 5e-5
"""

import argparse
import os
import time
from pathlib import Path
from typing import Optional

import torch
import torch.nn as nn
from torch.cuda.amp import GradScaler, autocast
from torch.utils.tensorboard import SummaryWriter

import sys


from models.siammask_lite import SiamMaskLite, SiamMaskLoss, build_model
from data.dataset import build_dataloaders


def train_one_epoch(
    model: SiamMaskLite,
    loader,
    criterion: SiamMaskLoss,
    optimizer: torch.optim.Optimizer,
    scaler: GradScaler,
    device: torch.device,
    epoch: int,
    writer: Optional[SummaryWriter] = None,
) -> float:
    model.train()
    total_loss = 0.0
    n_batches = 0

    for batch_idx, batch in enumerate(loader):
        template = batch["template"].to(device, non_blocking=True)
        search = batch["search"].to(device, non_blocking=True)
        gt_mask = batch["gt_mask"].to(device, non_blocking=True)
        gt_bbox = batch["gt_bbox"].to(device, non_blocking=True)
        gt_present = batch["gt_present"].to(device, non_blocking=True)

        optimizer.zero_grad(set_to_none=True)

        with autocast(device_type="cuda"):
            pred_mask, pred_bbox, pred_score = model(template, search)
            losses = criterion(pred_mask, pred_bbox, pred_score, gt_mask, gt_bbox, gt_present)

        scaler.scale(losses["total"]).backward()
        scaler.unscale_(optimizer)
        nn.utils.clip_grad_norm_(model.parameters(), max_norm=10.0)
        scaler.step(optimizer)
        scaler.update()

        total_loss += losses["total"].item()
        n_batches += 1

        if batch_idx % 50 == 0:
            step = epoch * len(loader) + batch_idx
            print(
                f"  [{batch_idx:>5d}/{len(loader)}] "
                f"total={losses['total'].item():.4f} "
                f"mask={losses['mask_loss'].item():.4f} "
                f"bbox={losses['bbox_loss'].item():.4f} "
                f"score={losses['score_loss'].item():.4f}"
            )
            if writer:
                writer.add_scalar("train/total_loss", losses["total"].item(), step)
                writer.add_scalar("train/mask_loss", losses["mask_loss"].item(), step)
                writer.add_scalar("train/bbox_loss", losses["bbox_loss"].item(), step)
                writer.add_scalar("train/score_loss", losses["score_loss"].item(), step)

    return total_loss / max(n_batches, 1)


@torch.no_grad()
def validate(
    model: SiamMaskLite,
    loader,
    criterion: SiamMaskLoss,
    device: torch.device,
) -> dict:
    model.eval()
    total_loss = 0.0
    total_iou = 0.0
    n_batches = 0

    for batch in loader:
        template = batch["template"].to(device, non_blocking=True)
        search = batch["search"].to(device, non_blocking=True)
        gt_mask = batch["gt_mask"].to(device, non_blocking=True)
        gt_bbox = batch["gt_bbox"].to(device, non_blocking=True)
        gt_present = batch["gt_present"].to(device, non_blocking=True)

        with autocast(device_type="cuda"):
            pred_mask, pred_bbox, pred_score = model(template, search)
            losses = criterion(pred_mask, pred_bbox, pred_score, gt_mask, gt_bbox, gt_present)

        total_loss += losses["total"].item()

        # Compute mask IoU for present targets
        present = gt_present.view(-1) > 0.5
        if present.any():
            pred_bin = (torch.sigmoid(pred_mask[present]) > 0.5).float()
            gt_bin = gt_mask[present]
            intersection = (pred_bin * gt_bin).sum(dim=(1, 2, 3))
            union = pred_bin.sum(dim=(1, 2, 3)) + gt_bin.sum(dim=(1, 2, 3)) - intersection
            iou = (intersection / (union + 1e-6)).mean().item()
            total_iou += iou

        n_batches += 1

    return {
        "val_loss": total_loss / max(n_batches, 1),
        "val_iou": total_iou / max(n_batches, 1),
    }


def main():
    parser = argparse.ArgumentParser(description="Train SiamMask-Lite")
    parser.add_argument("--phase", type=int, default=1, choices=[1, 2, 3])
    parser.add_argument("--checkpoint", type=str, default=None, help="Resume from checkpoint")
    parser.add_argument("--vos-root", nargs="*", default=[], help="VOS dataset roots")
    parser.add_argument("--yolo-images", type=str, default=None)
    parser.add_argument("--yolo-labels", type=str, default=None)
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--save-dir", type=str, default="checkpoints")
    parser.add_argument("--device", type=str, default="cuda")
    args = parser.parse_args()

    device = torch.device(args.device if torch.cuda.is_available() else "cpu")
    save_dir = Path(args.save_dir)
    save_dir.mkdir(parents=True, exist_ok=True)

    # Build model
    model = build_model(args.checkpoint)
    model = model.to(device)
    print(f"Model parameters: {sum(p.numel() for p in model.parameters()):,}")

    # Phase-specific loss weights
    if args.phase == 3:
        criterion = SiamMaskLoss(lambda_mask=2.0, lambda_bbox=5.0, lambda_score=1.0)
    else:
        criterion = SiamMaskLoss()

    # Optimizer with parameter groups
    if args.phase == 2:
        # Freeze backbone initially for phase 2
        for p in model.backbone.parameters():
            p.requires_grad = False
        param_groups = [
            {"params": model.correlation.parameters(), "lr": args.lr},
            {"params": model.decoder.parameters(), "lr": args.lr},
        ]
    else:
        param_groups = model.get_param_groups(args.lr)

    optimizer = torch.optim.AdamW(param_groups, weight_decay=1e-4)
    scaler = GradScaler()

    # Learning rate scheduler
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)

    # Build dataloader
    train_loader = build_dataloaders(
        vos_roots=args.vos_root if args.vos_root else None,
        yolo_images_dir=args.yolo_images,
        yolo_labels_dir=args.yolo_labels,
        batch_size=args.batch_size,
        num_workers=4,
    )

    writer = SummaryWriter(log_dir=str(save_dir / f"logs_phase{args.phase}"))

    best_loss = float("inf")
    unfreeze_epoch = 10 if args.phase == 2 else -1

    for epoch in range(args.epochs):
        # Unfreeze backbone in phase 2 after 10 epochs
        if epoch == unfreeze_epoch and args.phase == 2:
            print(">>> Unfreezing backbone with 0.01x LR")
            for p in model.backbone.parameters():
                p.requires_grad = True
            optimizer.add_param_group({
                "params": model.backbone.parameters(),
                "lr": args.lr * 0.01,
            })

        t0 = time.time()
        print(f"\n=== Epoch {epoch+1}/{args.epochs} (Phase {args.phase}) ===")

        avg_loss = train_one_epoch(
            model, train_loader, criterion, optimizer, scaler, device, epoch, writer
        )

        scheduler.step()
        elapsed = time.time() - t0
        print(f"  Epoch loss: {avg_loss:.4f} | Time: {elapsed:.1f}s | LR: {scheduler.get_last_lr()}")

        # Save checkpoint
        state = {
            "epoch": epoch,
            "phase": args.phase,
            "model": model.state_dict(),
            "optimizer": optimizer.state_dict(),
            "scheduler": scheduler.state_dict(),
            "loss": avg_loss,
        }
        torch.save(state, save_dir / f"phase{args.phase}_latest.pth")

        if avg_loss < best_loss:
            best_loss = avg_loss
            torch.save(state, save_dir / f"phase{args.phase}_best.pth")
            print(f"  *** New best: {best_loss:.4f}")

    writer.close()
    print(f"\nTraining complete. Best loss: {best_loss:.4f}")
    print(f"Checkpoints saved to: {save_dir}")


if __name__ == "__main__":
    main()
