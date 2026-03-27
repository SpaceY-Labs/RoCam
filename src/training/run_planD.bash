#!/usr/bin/env bash
# Plan D: Fine-tune smallrocket.pt at imgsz=544
# Usage: bash run_planD.bash [GPU_ID]
# Runs in tmux session 'planD_finetune'

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GPU_ID="${1:-0}"

export PATH="/u50/loux8/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export MKL_THREADING_LAYER=GNU
export OMP_NUM_THREADS=16
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True

CONDA_BASE="/u50/loux8/miniconda3"
source "${CONDA_BASE}/etc/profile.d/conda.sh"
conda activate CVPOC2

echo "============================================="
echo " Plan D: Fine-tune smallrocket @ imgsz=544"
echo " GPU: ${GPU_ID}"
echo " Start: $(date)"
echo "============================================="

cd "${SCRIPT_DIR}"
python train_planD_finetune.py --gpu "${GPU_ID}" --epochs 80 --batch 64

echo "============================================="
echo " Plan D COMPLETE: $(date)"
echo "============================================="
