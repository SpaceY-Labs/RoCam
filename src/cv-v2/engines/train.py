"""MaskTrackNet single-GPU training loop with AMP BF16 + gradient accumulation.

Stage-agnostic: stage-specific values (lr0, epochs, multi-scale list, etc.)
are passed via argparse. The Stage 1 / Stage 2 shell scripts wrap this with
hardcoded flags from the spec.

Usage example:
    cd src/cv-v2
    python engines/train.py \
        --davis-root data/DAVIS \
        --yt-vos-root data/youtube-vos \
        --epochs 80 --batch 16 --nbs 64 \
        --lr0 3e-4 --lrf 0.05 --warmup-epochs 3 \
        --multi-scale 384 448 512 576 640 \
        --neg-ratio 0.10 \
        --w-bce 1.0 --w-dice 1.0 --w-boundary 0.0 \
        --eval-every 5 \
        --save-dir runs/cv_v2/stage1 \
        --device cuda:0
"""
from __future__ import annotations
import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import torch
from torch.utils.tensorboard import SummaryWriter

from data.dataset import build_dataloaders
from data.samplers import MultiScaleSampler
from models.masktracknet import MaskTrackNet
from engines.losses import MaskLoss
from engines.schedulers import WarmupCosineLR
from engines.eval import evaluate_davis_val, load_davis_val_videos


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--davis-root", type=Path, required=True)
    p.add_argument("--yt-vos-root", type=Path, default=None)
    p.add_argument("--epochs", type=int, default=80)
    p.add_argument("--batch", type=int, default=16, help="per-iter batch size at base resolution")
    p.add_argument("--nbs", type=int, default=64, help="effective batch via grad accumulation")
    p.add_argument("--lr0", type=float, default=3e-4)
    p.add_argument("--lrf", type=float, default=0.05, help="lrf is final-lr-ratio (lrf*lr0)")
    p.add_argument("--weight-decay", type=float, default=0.05)
    p.add_argument("--warmup-epochs", type=int, default=3)
    p.add_argument("--multi-scale", type=int, nargs="+",
                   default=[384, 448, 512, 576, 640])
    p.add_argument("--neg-ratio", type=float, default=0.10)
    p.add_argument("--max-rotation-deg", type=float, default=15.0,
                   help="max +/- rotation angle for augmentation (0 to disable)")
    p.add_argument("--w-bce", type=float, default=1.0)
    p.add_argument("--w-dice", type=float, default=1.0)
    p.add_argument("--w-boundary", type=float, default=0.0)
    p.add_argument("--eval-every", type=int, default=5, help="epochs between DAVIS J&F evals")
    p.add_argument("--num-workers", type=int, default=8)
    p.add_argument("--length-per-epoch", type=int, default=10_000,
                   help="virtual epoch length in samples")
    p.add_argument("--save-dir", type=Path, required=True)
    p.add_argument("--init", type=Path, default=None,
                   help="path to .pt checkpoint to load weights from (Stage 2)")
    p.add_argument("--resume", type=Path, default=None,
                   help="path to checkpoint to resume training (full state)")
    p.add_argument("--device", type=str, default="cuda:0")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--smoke", action="store_true",
                   help="1-epoch DAVIS-only smoke test, batch 2, 384x384")
    p.add_argument("--save-period", type=int, default=5,
                   help="save checkpoint every N epochs in addition to best")
    return p.parse_args()


def main() -> None:
    args = parse_args()

    if args.smoke:
        args.epochs = 1
        args.batch = 2
        args.multi_scale = [384]
        args.length_per_epoch = 50
        args.eval_every = 0  # skip eval in smoke
        args.yt_vos_root = None  # DAVIS only
        args.num_workers = 2

    torch.manual_seed(args.seed)
    args.save_dir.mkdir(parents=True, exist_ok=True)
    writer = SummaryWriter(args.save_dir / "tb")

    device = torch.device(args.device)
    model = MaskTrackNet().to(device)

    if args.init is not None:
        state = torch.load(args.init, map_location="cpu")
        model.load_state_dict(state["model"] if "model" in state else state, strict=True)
        print(f"[train] loaded weights from {args.init}")

    optimizer = torch.optim.AdamW(
        model.parameters(), lr=args.lr0, weight_decay=args.weight_decay
    )
    loss_fn = MaskLoss(w_bce=args.w_bce, w_dice=args.w_dice, w_boundary=args.w_boundary)

    base_size = args.multi_scale[len(args.multi_scale) // 2]
    loader = build_dataloaders(
        yt_vos_root=args.yt_vos_root,
        davis_root=args.davis_root,
        out_size=base_size,
        batch_size=args.batch,
        num_workers=args.num_workers,
        neg_ratio=args.neg_ratio,
        seed=args.seed,
        length_per_epoch=args.length_per_epoch,
        max_rotation_deg=args.max_rotation_deg,
    )

    grad_accum = max(1, args.nbs // args.batch)
    iters_per_epoch = max(1, args.length_per_epoch // args.batch)
    total_steps = args.epochs * iters_per_epoch
    warmup_steps = args.warmup_epochs * iters_per_epoch
    scheduler = WarmupCosineLR(
        optimizer, lr0=args.lr0, lrf_ratio=args.lrf,
        total_steps=total_steps, warmup_steps=warmup_steps,
    )

    start_epoch = 0
    best_jf = 0.0
    if args.resume is not None:
        ckpt = torch.load(args.resume, map_location="cpu")
        model.load_state_dict(ckpt["model"])
        optimizer.load_state_dict(ckpt["optimizer"])
        scheduler.load_state_dict(ckpt["scheduler"])
        start_epoch = ckpt["epoch"] + 1
        best_jf = ckpt.get("best_jf", 0.0)
        print(f"[train] resumed at epoch {start_epoch}")

    multi_scale = MultiScaleSampler(args.multi_scale, seed=args.seed)
    val_videos = load_davis_val_videos(args.davis_root)
    if not args.smoke and len(val_videos) == 0:
        print("[train] WARNING: no DAVIS val videos found; eval will be skipped")

    global_step = start_epoch * iters_per_epoch

    for epoch in range(start_epoch, args.epochs):
        model.train()
        epoch_t0 = time.time()
        running = {"total": 0.0, "bce": 0.0, "dice": 0.0, "boundary": 0.0}

        # Set the iteration's input size - propagated to all wrapped datasets
        # via DataLoader workers picking it up at next-batch time.
        # NOTE: DataLoader workers cache datasets across batches; we mutate
        # the dataset in the main process, but workers see the original.
        # To make multi-scale actually take effect, we pass the size as
        # part of the batch via a custom collate (simpler approach: rebuild
        # the loader at start of every epoch with a new out_size).
        size = multi_scale.next_size()
        loader = build_dataloaders(
            yt_vos_root=args.yt_vos_root,
            davis_root=args.davis_root,
            out_size=size,
            batch_size=args.batch,
            num_workers=args.num_workers,
            neg_ratio=args.neg_ratio,
            seed=args.seed + epoch,
            length_per_epoch=args.length_per_epoch,
            max_rotation_deg=args.max_rotation_deg,
        )

        optimizer.zero_grad(set_to_none=True)
        for i, batch in enumerate(loader):
            ref_img = batch["reference_image"].to(device, non_blocking=True)
            ref_mask = batch["reference_mask"].to(device, non_blocking=True)
            tgt_img = batch["target_image"].to(device, non_blocking=True)
            tgt_mask = batch["target_mask"].to(device, non_blocking=True)

            with torch.autocast(device_type=device.type, dtype=torch.bfloat16):
                logits = model(ref_img, ref_mask, tgt_img)
                losses = loss_fn(logits, tgt_mask)
                loss = losses["total"] / grad_accum

            loss.backward()

            if (i + 1) % grad_accum == 0:
                optimizer.step()
                optimizer.zero_grad(set_to_none=True)
                scheduler.step()

            for k in running:
                running[k] += losses[k].item()
            global_step += 1

            if i % 20 == 0:
                writer.add_scalar("train/loss_total", losses["total"].item(), global_step)
                writer.add_scalar("train/loss_bce",   losses["bce"].item(),   global_step)
                writer.add_scalar("train/loss_dice",  losses["dice"].item(),  global_step)
                writer.add_scalar("train/loss_bnd",   losses["boundary"].item(), global_step)
                writer.add_scalar("train/lr",         optimizer.param_groups[0]["lr"], global_step)
                writer.add_scalar("train/size",       size, global_step)

        n_iters = max(1, len(loader))
        avg = {k: v / n_iters for k, v in running.items()}
        print(
            f"[epoch {epoch+1}/{args.epochs}]  size={size}  "
            f"loss={avg['total']:.4f}  bce={avg['bce']:.4f}  dice={avg['dice']:.4f}  "
            f"bnd={avg['boundary']:.4f}  lr={optimizer.param_groups[0]['lr']:.2e}  "
            f"time={time.time() - epoch_t0:.1f}s"
        )

        # Periodic checkpoint
        save_state = {
            "model": model.state_dict(),
            "optimizer": optimizer.state_dict(),
            "scheduler": scheduler.state_dict(),
            "epoch": epoch,
            "best_jf": best_jf,
            "args": vars(args),
        }
        torch.save(save_state, args.save_dir / "last.pt")
        if args.save_period > 0 and (epoch + 1) % args.save_period == 0:
            torch.save(save_state, args.save_dir / f"epoch_{epoch+1}.pt")

        # Periodic eval
        if args.eval_every > 0 and val_videos and (epoch + 1) % args.eval_every == 0:
            metrics = evaluate_davis_val(
                model, args.davis_root, val_videos, mode="A", progress=False,
            )
            print(f"[eval epoch {epoch+1}] J={metrics['J']:.4f}  F={metrics['F']:.4f}  "
                  f"J&F={metrics['J&F']:.4f}  n={metrics['n_frames']}")
            writer.add_scalar("val/J", metrics["J"], global_step)
            writer.add_scalar("val/F", metrics["F"], global_step)
            writer.add_scalar("val/J_F", metrics["J&F"], global_step)

            if metrics["J&F"] > best_jf:
                best_jf = metrics["J&F"]
                save_state["best_jf"] = best_jf
                torch.save(save_state, args.save_dir / "best.pt")
                print(f"[eval] new best J&F = {best_jf:.4f}; saved best.pt")

    # Final result file (mirrors V3 .v3_phase1_result pattern for orchestrator)
    result_path = args.save_dir / f".{args.save_dir.name}_result"
    final_ckpt = args.save_dir / ("best.pt" if (args.save_dir / "best.pt").exists() else "last.pt")
    result_path.write_text(str(final_ckpt))
    print(f"[train] done. best J&F = {best_jf:.4f}. result file: {result_path}")
    writer.close()


if __name__ == "__main__":
    main()
