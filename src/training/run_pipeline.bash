#!/usr/bin/env bash

# ===== V2 Pipeline 配置 =====
SESSION="rocket_v2"
LOG_FILE="pipeline_v2.log"
PID_FILE=".pipeline_v2.pid"
CONDA_BASE="/u50/loux8/miniconda3"
ENV_NAME="jplab"
PYTHON="${CONDA_BASE}/envs/${ENV_NAME}/bin/python"
TMUX="${CONDA_BASE}/bin/tmux"
PROJECT="/u50/loux8/datafrompega/runs/detect"
STAGE1_BEST="/u50/loux8/datafrompega/runs/detect/stage17/weights/best.pt"
# =============================

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

set -eo pipefail

have_tmux() { command -v "$TMUX" >/dev/null 2>&1 || command -v tmux >/dev/null 2>&1; }

run_training() {
    export PATH="${CONDA_BASE}/envs/${ENV_NAME}/bin:${CONDA_BASE}/bin:$PATH"

    cd "$DIR"
    echo "========================================" | tee -a "$LOG_FILE"
    echo "[$(date)] V2 Pipeline 开始" | tee -a "$LOG_FILE"
    echo "========================================" | tee -a "$LOG_FILE"

    MAX_RETRY=3

    # ---- Stage 1b: 从 Stage 1 best.pt 延长训练 (MuSGD, 200ep, 4卡) ----
    echo "" | tee -a "$LOG_FILE"
    echo "===== Stage 1b: 延长训练 200ep (4卡 DDP, MuSGD) =====" | tee -a "$LOG_FILE"
    for attempt in $(seq 1 $MAX_RETRY); do
        echo "[Stage1b] 第 ${attempt} 次尝试..." | tee -a "$LOG_FILE"
        if "$PYTHON" train_stage1b.py \
            --model "$STAGE1_BEST" \
            --project "$PROJECT" --name stage1b \
            2>&1 | tee -a "$LOG_FILE"; then
            break
        fi
        echo "[Stage1b] 失败, 60s 后重试..." | tee -a "$LOG_FILE"
        sleep 60
    done

    STAGE1B_RESULT="$PROJECT/stage1b/.stage1b_result"
    if [ -f "$STAGE1B_RESULT" ]; then
        STAGE1B_BEST=$(cat "$STAGE1B_RESULT")
        echo "[Stage1b] best.pt = $STAGE1B_BEST" | tee -a "$LOG_FILE"
    else
        echo "[ERROR] Stage 1b 未产生 .stage1b_result" | tee -a "$LOG_FILE"
        exit 1
    fi

    # ---- Stage 2: 单卡 MuSGD 精调 (rect=True, Albumentations) ----
    echo "" | tee -a "$LOG_FILE"
    echo "===== Stage 2: 抗干扰精调 80ep (单卡 MuSGD, rect=True) =====" | tee -a "$LOG_FILE"
    for attempt in $(seq 1 $MAX_RETRY); do
        echo "[Stage2] 第 ${attempt} 次尝试..." | tee -a "$LOG_FILE"
        if "$PYTHON" train_stage2.py \
            --model "$STAGE1B_BEST" \
            --project "$PROJECT" --name stage2_v2 \
            2>&1 | tee -a "$LOG_FILE"; then
            break
        fi
        echo "[Stage2] 失败, 60s 后重试..." | tee -a "$LOG_FILE"
        sleep 60
    done

    STAGE2_RESULT="$PROJECT/stage2_v2/.stage2_result"
    if [ -f "$STAGE2_RESULT" ]; then
        STAGE2_BEST=$(cat "$STAGE2_RESULT")
        echo "[Stage2] best.pt = $STAGE2_BEST" | tee -a "$LOG_FILE"
    else
        echo "[ERROR] Stage 2 未产生 .stage2_result" | tee -a "$LOG_FILE"
        exit 1
    fi

    # ---- Stage 3: 单卡极低 LR 抛光 ----
    echo "" | tee -a "$LOG_FILE"
    echo "===== Stage 3: 低 LR 抛光 40ep (单卡 MuSGD) =====" | tee -a "$LOG_FILE"
    for attempt in $(seq 1 $MAX_RETRY); do
        echo "[Stage3] 第 ${attempt} 次尝试..." | tee -a "$LOG_FILE"
        if "$PYTHON" train_stage3.py \
            --model "$STAGE2_BEST" \
            --project "$PROJECT" --name stage3_v2 \
            2>&1 | tee -a "$LOG_FILE"; then
            break
        fi
        echo "[Stage3] 失败, 60s 后重试..." | tee -a "$LOG_FILE"
        sleep 60
    done

    # ---- Evaluate ----
    echo "" | tee -a "$LOG_FILE"
    echo "===== V2 最终评估 =====" | tee -a "$LOG_FILE"
    STAGE3_RESULT="$PROJECT/stage3_v2/.stage3_result"
    if [ -f "$STAGE3_RESULT" ]; then
        FINAL_MODEL=$(cat "$STAGE3_RESULT")
    else
        FINAL_MODEL="$STAGE2_BEST"
    fi
    "$PYTHON" evaluate.py --model "$FINAL_MODEL" 2>&1 | tee -a "$LOG_FILE"

    echo "" | tee -a "$LOG_FILE"
    echo "========================================" | tee -a "$LOG_FILE"
    echo "[$(date)] V2 Pipeline 完成!" | tee -a "$LOG_FILE"
    echo "========================================" | tee -a "$LOG_FILE"
}

start_tmux() {
    local tmux_bin="$TMUX"
    command -v "$tmux_bin" >/dev/null 2>&1 || tmux_bin="tmux"

    if "$tmux_bin" has-session -t "$SESSION" 2>/dev/null; then
        echo "已在跑: tmux 会话 '$SESSION' 存在。用 '$0 attach' 或 '$0 tail' 查看。"
        exit 0
    fi
    "$tmux_bin" new -d -s "$SESSION" "bash --norc -c 'export PATH=${CONDA_BASE}/envs/${ENV_NAME}/bin:${CONDA_BASE}/bin:\$PATH; cd ${DIR}; bash ${DIR}/run_pipeline.bash _run_internal 2>&1 | tee -a ${DIR}/pipeline_v2_tmux.log'"
    echo "已用 tmux 启动 V2 pipeline。会话: $SESSION"
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
        echo "未发现运行中的 V2 pipeline"
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
    pkill -f "train_stage" 2>/dev/null || true
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
  start   启动 V2 三阶段训练 pipeline (tmux 优先, 关电脑不影响)
  status  查看运行状态 + GPU
  stop    停止训练
  tail    实时看日志
  attach  接入 tmux 会话 (Ctrl-b d 退出)

V2 Pipeline:
  Stage 1b: 4卡 DDP 200ep (MuSGD, lr0=0.005, mosaic=0.2)
  Stage 2:  单卡 80ep  (MuSGD, lr0=0.001, rect=True + Albumentations)
  Stage 3:  单卡 40ep  (MuSGD, lr0=0.0002, 低增强)
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
