#!/usr/bin/env bash
set -euo pipefail

SESSION="planG_clone63"

if tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "[INFO] tmux session '$SESSION' already exists — attaching"
    tmux attach -t "$SESSION"
    exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

tmux new-session -d -s "$SESSION" bash
tmux send-keys -t "$SESSION" "source /opt/miniconda3/etc/profile.d/conda.sh && conda activate CVPOC2" Enter
tmux send-keys -t "$SESSION" "cd ${SCRIPT_DIR}" Enter
tmux send-keys -t "$SESSION" "python3 train_planG_clone63.py --gpu 2 --batch 16 2>&1 | tee /tmp/planG_clone63.log" Enter

echo "[OK] Plan G launched in tmux session: $SESSION"
echo "     Attach: tmux attach -t $SESSION"
