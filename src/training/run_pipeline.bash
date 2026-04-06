#!/usr/bin/env bash

# ===== V3 Pipeline 配置 =====
SESSION="rocket_v3"
LOG_FILE="pipeline_v3.log"
PID_FILE=".pipeline_v3.pid"
CONDA_BASE="/u50/loux8/miniconda3"
ENV_NAME="jplab"
PYTHON="${CONDA_BASE}/envs/${ENV_NAME}/bin/python"
TMUX="${CONDA_BASE}/bin/tmux"
PROJECT="/u50/loux8/datafrompega/runs/detect"
PHASE1_MODEL="/u50/loux8/datafrompega/runs/detect/stage1b/weights/best.pt"
# =============================

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

set -eo pipefail

have_tmux() { command -v "$TMUX" >/dev/null 2>&1 || command -v tmux >/dev/null 2>&1; }

run_training() {
    export PATH="${CONDA_BASE}/envs/${ENV_NAME}/bin:${CONDA_BASE}/bin:$PATH"

    cd "$DIR"
    echo "========================================" | tee -a "$LOG_FILE"
    echo "[$(date)] V3 Pipeline 开始" | tee -a "$LOG_FILE"
    echo "  单卡 + nbs=128, 原生 augmentations, scale=0.25, erasing=0.30" | tee -a "$LOG_FILE"
    echo "========================================" | tee -a "$LOG_FILE"

    MAX_RETRY=3

    # ---- Phase 1: 小目标 + 鲁棒性联合训练 (250ep, 单卡) ----
    echo "" | tee -a "$LOG_FILE"
    echo "===== V3 Phase 1: 小目标+鲁棒性 250ep (单卡, SGD lr=0.0003, nbs=128) =====" | tee -a "$LOG_FILE"
    for attempt in $(seq 1 $MAX_RETRY); do
        echo "[Phase1] 第 ${attempt} 次尝试..." | tee -a "$LOG_FILE"
        if "$PYTHON" train_v3_phase1.py \
            --model "$PHASE1_MODEL" \
            --project "$PROJECT" --name v3_phase1 \
            2>&1 | tee -a "$LOG_FILE"; then
            break
        fi
        echo "[Phase1] 失败, 60s 后重试..." | tee -a "$LOG_FILE"
        sleep 60
    done

    P1_RESULT="$PROJECT/v3_phase1/.v3_phase1_result"
    if [ -f "$P1_RESULT" ]; then
        P1_BEST=$(cat "$P1_RESULT")
        echo "[Phase1] best.pt = $P1_BEST" | tee -a "$LOG_FILE"
    else
        echo "[ERROR] Phase 1 未产生 .v3_phase1_result" | tee -a "$LOG_FILE"
        exit 1
    fi

    # ---- Phase 2: 低 LR 精调 (80ep, 单卡, regime 一致) ----
    echo "" | tee -a "$LOG_FILE"
    echo "===== V3 Phase 2: 低LR精调 80ep (单卡, SGD lr=0.0001, nbs=128) =====" | tee -a "$LOG_FILE"
    for attempt in $(seq 1 $MAX_RETRY); do
        echo "[Phase2] 第 ${attempt} 次尝试..." | tee -a "$LOG_FILE"
        if "$PYTHON" train_v3_phase2.py \
            --model "$P1_BEST" \
            --project "$PROJECT" --name v3_phase2 \
            2>&1 | tee -a "$LOG_FILE"; then
            break
        fi
        echo "[Phase2] 失败, 60s 后重试..." | tee -a "$LOG_FILE"
        sleep 60
    done

    # ---- Evaluate ----
    echo "" | tee -a "$LOG_FILE"
    echo "===== V3 最终评估 =====" | tee -a "$LOG_FILE"
    P2_RESULT="$PROJECT/v3_phase2/.v3_phase2_result"
    if [ -f "$P2_RESULT" ]; then
        FINAL_MODEL=$(cat "$P2_RESULT")
    else
        FINAL_MODEL="$P1_BEST"
    fi
    "$PYTHON" evaluate.py --model "$FINAL_MODEL" 2>&1 | tee -a "$LOG_FILE"

    echo "" | tee -a "$LOG_FILE"
    echo "========================================" | tee -a "$LOG_FILE"
    echo "[$(date)] V3 Pipeline 完成!" | tee -a "$LOG_FILE"
    echo "========================================" | tee -a "$LOG_FILE"
}

start_tmux() {
    local tmux_bin="$TMUX"
    command -v "$tmux_bin" >/dev/null 2>&1 || tmux_bin="tmux"

    if "$tmux_bin" has-session -t "$SESSION" 2>/dev/null; then
        echo "已在跑: tmux 会话 '$SESSION' 存在。用 '$0 attach' 或 '$0 tail' 查看。"
        exit 0
    fi
    "$tmux_bin" new -d -s "$SESSION" "bash --norc -c 'export PATH=${CONDA_BASE}/envs/${ENV_NAME}/bin:${CONDA_BASE}/bin:\$PATH; cd ${DIR}; bash ${DIR}/run_pipeline.bash _run_internal 2>&1 | tee -a ${DIR}/pipeline_v3_tmux.log'"
    echo "已用 tmux 启动 V3 pipeline。会话: $SESSION"
    echo "  查看日志:  $0 tail"
    echo "  接入会话:  $0 attach (Ctrl-b d 退出)"
    echo "  停止训练:  $0 stop"
}

start_nohup() {
    if [[ -f "$PID_FILE" ]] && ps -p "$(cat "$PID_FILE")" >/dev/null 2>&1; then
        echo "已在跑: PID=$(cat "$PID_FILE")"
        exit 0
    fi
    nohup bash --norc -c "export PATH=${CONDA_BASE}/envs/${ENV_NAME}/bin:${CONDA_BASE}/bin:\$PATH; cd ${DIR}; bash ${DIR}/run_pipeline.bash _run_internal" > "${DIR}/${LOG_FILE}" 2>&1 & echo $! > "$PID_FILE"
    echo "已用 nohup 启动。PID=$(cat "$PID_FILE")"
    echo "  查看日志:  $0 tail"
}

start() {
    if have_tmux; then
        start_tmux
    else
        start_nohup
    fi
}

status() {
    local tmux_bin="$TMUX"
    command -v "$tmux_bin" >/dev/null 2>&1 || tmux_bin="tmux"
    if "$tmux_bin" has-session -t "$SESSION" 2>/dev/null; then
        echo "tmux 会话 '$SESSION' 正在运行"
    elif [[ -f "$PID_FILE" ]] && ps -p "$(cat "$PID_FILE")" >/dev/null 2>&1; then
        echo "nohup 运行中 PID=$(cat "$PID_FILE")"
    else
        echo "未发现运行中的 V3 pipeline"
    fi
    echo "—— GPU ——"
    nvidia-smi --query-gpu=index,memory.used,memory.free,utilization.gpu --format=csv 2>/dev/null || true
    echo "—— 最新日志 ——"
    tail -5 "$DIR/$LOG_FILE" 2>/dev/null || true
}

stop() {
    local tmux_bin="$TMUX"
    command -v "$tmux_bin" >/dev/null 2>&1 || tmux_bin="tmux"
    if "$tmux_bin" has-session -t "$SESSION" 2>/dev/null; then
        "$tmux_bin" send-keys -t "$SESSION" C-c
        sleep 3
        "$tmux_bin" kill-session -t "$SESSION" 2>/dev/null || true
        echo "已停止 tmux 会话"
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
    pkill -f "train_v3" 2>/dev/null || true
    echo "已停止"
}

tail_log() {
    [[ -f "$DIR/$LOG_FILE" ]] || { echo "日志不存在: $DIR/$LOG_FILE"; exit 1; }
    tail -f "$DIR/$LOG_FILE"
}

attach() {
    local tmux_bin="$TMUX"
    command -v "$tmux_bin" >/dev/null 2>&1 || tmux_bin="tmux"
    "$tmux_bin" has-session -t "$SESSION" 2>/dev/null || { echo "会话不存在"; exit 1; }
    "$tmux_bin" attach -t "$SESSION"
}

usage() {
    cat <<EOF
用法: $0 {start|status|stop|tail|attach}
  start   启动 V3 两阶段训练 pipeline (tmux 优先, 关电脑不影响)
  status  查看运行状态 + GPU
  stop    停止训练
  tail    实时看日志
  attach  接入 tmux 会话 (Ctrl-b d 退出)

V3 Pipeline (小目标 + 鲁棒性增强):
  Phase 1: 单卡 250ep (SGD lr=0.0003, nbs=128, scale=0.25, erasing=0.30 + Albumentations)
  Phase 2: 单卡 80ep  (SGD lr=0.0001, nbs=128, 降低增强, rect=False 保持一致)
EOF
}

cmd="${1:-}"
case "$cmd" in
    _run_internal) run_training ;;
    start)   start ;;
    status)  status ;;
    stop)    stop ;;
    tail)    tail_log ;;
    attach)  attach ;;
    *)       usage; exit 1 ;;
esac
