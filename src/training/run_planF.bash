#!/usr/bin/env bash
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
echo " Plan F: smallrocket small-target focus @544"
echo " GPU: ${GPU_ID} | Start: $(date)"
echo "============================================="
cd "${SCRIPT_DIR}"
python train_planF_small.py --gpu "${GPU_ID}" --epochs 80 --batch 64
echo "============================================="
echo " Plan F COMPLETE: $(date)"
echo "============================================="
