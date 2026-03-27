#!/usr/bin/env bash
# Plan E: yolo26s at imgsz=640 (compromise)
# Usage: bash run_planE.bash [GPU_ID]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GPU_ID="${1:-1}"

export PATH="/u50/loux8/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export MKL_THREADING_LAYER=GNU
export OMP_NUM_THREADS=8
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True

CONDA_BASE="/u50/loux8/miniconda3"
source "${CONDA_BASE}/etc/profile.d/conda.sh"
conda activate CVPOC2

echo "============================================="
echo " Plan E: yolo26s @ imgsz=640"
echo " GPU: ${GPU_ID}"
echo " Start: $(date)"
echo "============================================="

cd "${SCRIPT_DIR}"
python train_planE_640.py --gpu "${GPU_ID}" --epochs 200 --batch 32

echo "============================================="
echo " Plan E COMPLETE: $(date)"
echo "============================================="
