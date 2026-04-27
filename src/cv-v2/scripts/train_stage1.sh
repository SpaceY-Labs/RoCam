#!/usr/bin/env bash
# Stage 1: VOS pretraining on YT-VOS + DAVIS.
# Mandatory path; produces the shippable cv-v2 model.
# Reference: spec sec 5.3.

set -eo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR/.."

# Optional model arg used by run_pipeline.sh (Stage 2 receives Stage 1 best).
# Stage 1 has no init; ignore $1 if set.

python engines/train.py \
    --davis-root data/DAVIS \
    --yt-vos-root data/youtube-vos \
    --epochs 80 \
    --batch 16 \
    --nbs 64 \
    --lr0 3e-4 \
    --lrf 0.05 \
    --weight-decay 0.05 \
    --warmup-epochs 3 \
    --multi-scale 384 448 512 576 640 \
    --neg-ratio 0.10 \
    --max-rotation-deg 15.0 \
    --w-bce 1.0 --w-dice 1.0 --w-boundary 0.0 \
    --eval-every 5 \
    --save-period 5 \
    --num-workers 8 \
    --length-per-epoch 10000 \
    --save-dir runs/cv_v2/stage1 \
    --device cuda:0 \
    --seed 0
