#!/usr/bin/env bash
# cv-v2 training pipeline orchestrator.
# Pattern mirrors src/training/run_pipeline.bash (V3 detector).
#
# Usage:
#   ./run_pipeline.sh start                  # Stage 1 only (default; mandatory path)
#   ./run_pipeline.sh start --with-stage2    # Stage 1 then Stage 2 (optional)
#   ./run_pipeline.sh status
#   ./run_pipeline.sh stop
#   ./run_pipeline.sh tail
#   ./run_pipeline.sh attach

SESSION="cv_v2"
LOG_FILE="pipeline_cv_v2.log"
PID_FILE=".pipeline_cv_v2.pid"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR/.."

set -eo pipefail

have_tmux() { command -v tmux >/dev/null 2>&1; }

run_training() {
    local with_stage2="${1:-no}"

    echo "========================================" | tee -a "$LOG_FILE"
    echo "[$(date)] cv-v2 pipeline start" | tee -a "$LOG_FILE"
    echo "  Stage 2 enabled: $with_stage2" | tee -a "$LOG_FILE"
    echo "========================================" | tee -a "$LOG_FILE"

    MAX_RETRY=3

    # ---- Stage 1: YT-VOS+DAVIS pretrain ----
    echo "" | tee -a "$LOG_FILE"
    echo "===== Stage 1: VOS pretrain (80ep) =====" | tee -a "$LOG_FILE"
    for attempt in $(seq 1 $MAX_RETRY); do
        echo "[Stage1] attempt $attempt..." | tee -a "$LOG_FILE"
        if bash scripts/train_stage1.sh 2>&1 | tee -a "$LOG_FILE"; then
            break
        fi
        echo "[Stage1] failed, retry in 60s..." | tee -a "$LOG_FILE"
        sleep 60
    done

    S1_RESULT="runs/cv_v2/stage1/.stage1_result"
    if [[ -f "$S1_RESULT" ]]; then
        S1_BEST=$(cat "$S1_RESULT")
        echo "[Stage1] best.pt = $S1_BEST" | tee -a "$LOG_FILE"
    else
        echo "[ERROR] Stage 1 produced no .stage1_result" | tee -a "$LOG_FILE"
        exit 1
    fi

    # ---- Stage 2 (optional) ----
    if [[ "$with_stage2" == "yes" ]]; then
        echo "" | tee -a "$LOG_FILE"
        echo "===== Stage 2: domain fine-tune (40ep) =====" | tee -a "$LOG_FILE"
        if [[ ! -d data/rockets-masks ]]; then
            echo "[Stage2] WARNING: data/rockets-masks not present; skipping Stage 2" | tee -a "$LOG_FILE"
        else
            for attempt in $(seq 1 $MAX_RETRY); do
                echo "[Stage2] attempt $attempt..." | tee -a "$LOG_FILE"
                if bash scripts/train_stage2.sh "$S1_BEST" 2>&1 | tee -a "$LOG_FILE"; then
                    break
                fi
                echo "[Stage2] failed, retry in 60s..." | tee -a "$LOG_FILE"
                sleep 60
            done
        fi
    fi

    echo "" | tee -a "$LOG_FILE"
    echo "========================================" | tee -a "$LOG_FILE"
    echo "[$(date)] cv-v2 pipeline complete" | tee -a "$LOG_FILE"
    echo "========================================" | tee -a "$LOG_FILE"
}

start_tmux() {
    local stage2_arg="${1:-no}"
    if tmux has-session -t "$SESSION" 2>/dev/null; then
        echo "Already running. Use '$0 attach' or '$0 tail'."
        exit 0
    fi
    tmux new -d -s "$SESSION" "cd $(pwd) && bash scripts/run_pipeline.sh _run_internal $stage2_arg 2>&1 | tee -a pipeline_cv_v2_tmux.log"
    echo "Started cv-v2 pipeline in tmux session: $SESSION"
    echo "  Tail logs:   $0 tail"
    echo "  Attach:      $0 attach (Ctrl-b d to detach)"
    echo "  Stop:        $0 stop"
}

start_nohup() {
    local stage2_arg="${1:-no}"
    if [[ -f "$PID_FILE" ]] && ps -p "$(cat "$PID_FILE")" >/dev/null 2>&1; then
        echo "Already running. PID=$(cat "$PID_FILE")"
        exit 0
    fi
    nohup bash scripts/run_pipeline.sh _run_internal "$stage2_arg" > "$LOG_FILE" 2>&1 & echo $! > "$PID_FILE"
    echo "Started via nohup. PID=$(cat "$PID_FILE")"
}

start() {
    local stage2_arg="no"
    [[ "${1:-}" == "--with-stage2" ]] && stage2_arg="yes"
    if have_tmux; then
        start_tmux "$stage2_arg"
    else
        start_nohup "$stage2_arg"
    fi
}

status() {
    if tmux has-session -t "$SESSION" 2>/dev/null; then
        echo "tmux session '$SESSION' is running"
    elif [[ -f "$PID_FILE" ]] && ps -p "$(cat "$PID_FILE")" >/dev/null 2>&1; then
        echo "nohup running. PID=$(cat "$PID_FILE")"
    else
        echo "No cv-v2 pipeline running"
    fi
    echo "---- GPU ----"
    nvidia-smi --query-gpu=index,memory.used,memory.free,utilization.gpu --format=csv 2>/dev/null || true
    echo "---- Latest log ----"
    tail -5 "$LOG_FILE" 2>/dev/null || true
}

stop() {
    if tmux has-session -t "$SESSION" 2>/dev/null; then
        tmux send-keys -t "$SESSION" C-c
        sleep 3
        tmux kill-session -t "$SESSION" 2>/dev/null || true
        echo "Stopped tmux session"
    fi
    if [[ -f "$PID_FILE" ]]; then
        PID=$(cat "$PID_FILE")
        if ps -p "$PID" >/dev/null 2>&1; then
            kill "$PID" || true
            sleep 3
            ps -p "$PID" >/dev/null 2>&1 && kill -9 "$PID" || true
        fi
        rm -f "$PID_FILE"
    fi
    pkill -f "engines/train.py" 2>/dev/null || true
    echo "Stopped."
}

tail_log() {
    [[ -f "$LOG_FILE" ]] || { echo "No log: $LOG_FILE"; exit 1; }
    tail -f "$LOG_FILE"
}

attach() {
    tmux has-session -t "$SESSION" 2>/dev/null || { echo "No session"; exit 1; }
    tmux attach -t "$SESSION"
}

usage() {
    cat <<EOF
Usage: $0 {start|status|stop|tail|attach}

Subcommands:
  start [--with-stage2]   Start training pipeline (tmux preferred).
                          Default: Stage 1 only (mandatory).
                          --with-stage2: also run Stage 2 (optional).
  status                  Show running state + GPU + recent log.
  stop                    Kill the pipeline.
  tail                    Tail the log file.
  attach                  Attach to tmux session (Ctrl-b d to detach).
EOF
}

cmd="${1:-}"
case "$cmd" in
    _run_internal) run_training "${2:-no}" ;;
    start)         shift; start "$@" ;;
    status)        status ;;
    stop)          stop ;;
    tail)          tail_log ;;
    attach)        attach ;;
    *)             usage; exit 1 ;;
esac
