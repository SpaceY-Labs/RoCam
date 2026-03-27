#!/usr/bin/env bash
# Plan C: Train yolo26s (3-head) at imgsz=544 for deployment
# Usage: bash run_planC.bash [GPU_ID]
# Runs in tmux session 'planC_train'

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GPU_ID="${1:-3}"
PROJECT="/u50/loux8/datafrompega/runs/detect"
PHASE1_RESULT="${PROJECT}/planC_phase1/.planC_phase1_result"

export PATH="/u50/loux8/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export MKL_THREADING_LAYER=GNU
export OMP_NUM_THREADS=16
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True

CONDA_BASE="/u50/loux8/miniconda3"
source "${CONDA_BASE}/etc/profile.d/conda.sh"
conda activate CVPOC2

run_phase1() {
    echo "=== Plan C Phase 1: 300 epochs, imgsz=544, yolo26s, GPU ${GPU_ID} ==="
    cd "${SCRIPT_DIR}"
    python train_planC_phase1.py --gpu "${GPU_ID}" --epochs 300 --batch 64
}

run_phase2() {
    if [ ! -f "${PHASE1_RESULT}" ]; then
        echo "[ERROR] Phase 1 result not found: ${PHASE1_RESULT}"
        exit 1
    fi
    BEST_PT=$(cat "${PHASE1_RESULT}")
    echo "=== Plan C Phase 2: 100 epochs, fine-tune from ${BEST_PT} ==="
    cd "${SCRIPT_DIR}"
    python train_planC_phase2.py --model "${BEST_PT}" --gpu "${GPU_ID}" --epochs 100 --batch 64
}

main() {
    echo "============================================="
    echo " Plan C Pipeline: yolo26s @ imgsz=544"
    echo " GPU: ${GPU_ID}"
    echo " Start: $(date)"
    echo "============================================="

    run_phase1
    echo "[Phase 1 DONE] $(date)"

    run_phase2
    echo "[Phase 2 DONE] $(date)"

    echo "============================================="
    echo " Plan C Pipeline COMPLETE: $(date)"
    echo "============================================="
}

main 2>&1 | tee "${PROJECT}/planC_pipeline.log"
