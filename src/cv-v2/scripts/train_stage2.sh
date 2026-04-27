#!/usr/bin/env bash
# Stage 2: per-domain fine-tune (default: rocket footage).
# OPTIONAL - gated on having mask data for the chosen domain.
# Reference: spec sec 5.4.
#
# Usage:
#   ./train_stage2.sh <stage1_best_pt> [--domain-root <path>]

set -eo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR/.."

INIT="${1:-runs/cv_v2/stage1/best.pt}"
DOMAIN_ROOT="${2:-data/rockets-masks}"

if [[ ! -f "$INIT" ]]; then
    echo "[train_stage2] ERROR: Stage 1 init checkpoint not found at $INIT" >&2
    exit 1
fi
if [[ ! -d "$DOMAIN_ROOT" ]]; then
    echo "[train_stage2] ERROR: domain root not found at $DOMAIN_ROOT" >&2
    echo "  Run scripts/prepare_domain_masks.py first to generate mask data." >&2
    exit 1
fi

python engines/train.py \
    --davis-root "$DOMAIN_ROOT" \
    --epochs 40 \
    --batch 4 \
    --nbs 32 \
    --lr0 1e-4 \
    --lrf 0.10 \
    --weight-decay 0.05 \
    --warmup-epochs 1 \
    --multi-scale 768 832 896 960 1024 \
    --neg-ratio 0.05 \
    --max-rotation-deg 20.0 \
    --w-bce 1.0 --w-dice 1.0 --w-boundary 0.5 \
    --eval-every 5 \
    --save-period 5 \
    --num-workers 8 \
    --length-per-epoch 5000 \
    --save-dir runs/cv_v2/stage2 \
    --init "$INIT" \
    --device cuda:0 \
    --seed 0
