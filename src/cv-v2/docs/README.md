# cv-v2 Quickstart (Grace)

cv-v2 is a class-agnostic mask-conditioned tracker. Stage 1 (mandatory) trains the
shippable model on YouTube-VOS + DAVIS. Stage 2 (optional) is a per-domain fine-tune.

Spec: `docs/superpowers/specs/2026-04-27-cv-v2-mask-tracker-design.md`
Plan: `docs/superpowers/plans/2026-04-27-cv-v2-mask-tracker-plan.md`

## 1. Environment

```bash
conda create -n cv_v2 python=3.10 -y
conda activate cv_v2
pip install -r src/cv-v2/requirements.txt
# Confirm CUDA:
python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

## 2. Stage data

DAVIS-2017 and YouTube-VOS 2019 must be staged at:

```
src/cv-v2/data/DAVIS/
src/cv-v2/data/youtube-vos/train/
```

DAVIS download: `bash src/cv-v2/scripts/download_davis.sh` (or unzip a manually
staged release from https://davischallenge.org/davis2017/code.html).

YT-VOS: register at https://youtube-vos.org/, or `pip install kaggle` + place
`~/.kaggle/kaggle.json`, then download. Total ~22 GB.

## 3. Smoke test (5-10 min on H100)

```bash
cd src/cv-v2
python engines/train.py \
    --davis-root data/DAVIS \
    --save-dir runs/smoke \
    --device cuda:0 --smoke
```

Expected: 1 epoch (50 samples) completes, `runs/smoke/last.pt` written, no crashes.

## 4. Stage 1 (full run, ~6-18 h on H100)

```bash
cd src/cv-v2
bash scripts/run_pipeline.sh start
bash scripts/run_pipeline.sh tail        # follow log
bash scripts/run_pipeline.sh status      # GPU + recent log
```

Acceptance: DAVIS-2017 val J&F >= 0.65 (Mode A). Logged every 5 epochs.

Outputs:
- `runs/cv_v2/stage1/best.pt` - best DAVIS J&F checkpoint (the shippable model)
- `runs/cv_v2/stage1/last.pt` - most recent checkpoint
- `runs/cv_v2/stage1/tb/` - TensorBoard logs

## 5. Stage 2 (optional, ~2-4 h on H100)

```bash
cd src/cv-v2
# 1. Generate domain masks (e.g., rockets):
python scripts/prepare_domain_masks.py \
    --yolo-images path/to/rocket_imgs --yolo-labels path/to/rocket_labels \
    --out data/rockets-masks --bbox-mode rectangle

# 2. Fine-tune:
bash scripts/train_stage2.sh runs/cv_v2/stage1/best.pt
```

Acceptance: domain val mIoU >= 0.70 (Mode A).

## 6. Eval-only (any checkpoint)

```bash
cd src/cv-v2
python -c "
import sys; sys.path.insert(0, '.')
import torch
from models.masktracknet import MaskTrackNet
from engines.eval import evaluate_davis_val, load_davis_val_videos
from pathlib import Path

m = MaskTrackNet().cuda().eval()
m.load_state_dict(torch.load('runs/cv_v2/stage1/best.pt')['model'])
videos = load_davis_val_videos(Path('data/DAVIS'))
print(evaluate_davis_val(m, Path('data/DAVIS'), videos, mode='A'))
print(evaluate_davis_val(m, Path('data/DAVIS'), videos, mode='B'))
"
```

## 7. FLOP / param report

```bash
cd src/cv-v2 && python scripts/flop_report.py
```

Prints param count + GFLOPs at 384/512/640/768/1024.

## Troubleshooting

- **OOM at 640px batch=16:** drop `--batch` to 8 and `--nbs` stays 64 (grad-accum doubles). VRAM usage scales linearly with batch.
- **Slow dataloader (CPU pegged):** bump `--num-workers` from 8 to 16. Pre-resize-cache YT-VOS at 640 max-side if I/O is the bottleneck.
- **Dataloader workers see stale `out_size`:** confirmed; the train loop rebuilds the loader at each epoch with a fresh `out_size`. If you change multi-scale config mid-run, restart.
- **Eval is slow (>5 min):** drop `--eval-every` from 5 to 10 in the stage-1 shell script.
