#!/usr/bin/env bash
set -euo pipefail

# ===== 配置 =====
ENV_NAME="jplab"
SESSION="rocket_pipeline"
LOG_FILE="pipeline.log"
PID_FILE=".pipeline.pid"
BATCH=192
PROJECT="/u50/loux8/datafrompega/runs/detect"
# =================

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

have_tmux() { command -v tmux >/dev/null 2>&1; }

detect_gpus() {
    python3 -c "
import subprocess
r = subprocess.run(['nvidia-smi','--query-gpu=index,memory.free','--format=csv,noheader,nounits'],
                   capture_output=True, text=True)
usable = []
for line in r.stdout.strip().split('\n'):
    parts = line.split(',')
    if len(parts)==2 and int(parts[1].strip()) > 40000:
        usable.append(parts[0].strip())
print(','.join(usable) if usable else '')
print(len(usable))
"
}

run_training() {
    source ~/.bashrc
    conda activate ${ENV_NAME}

    cd "$DIR"
    echo "========================================" | tee -a "$LOG_FILE"
    echo "[$(date)] Pipeline 开始" | tee -a "$LOG_FILE"
    echo "========================================" | tee -a "$LOG_FILE"

    # GPU 探测
    GPU_INFO=$(detect_gpus)
    GPU_LIST=$(echo "$GPU_INFO" | head -1)
    N_GPU=$(echo "$GPU_INFO" | tail -1)

    if [ -z "$GPU_LIST" ] || [ "$N_GPU" -eq 0 ]; then
        echo "[ERROR] 无可用 GPU (>40GB free)" | tee -a "$LOG_FILE"
        exit 1
    fi

    ACTUAL_BATCH=$(( (BATCH / N_GPU) * N_GPU ))
    echo "[GPU] 使用 $GPU_LIST ($N_GPU 卡), batch=$ACTUAL_BATCH" | tee -a "$LOG_FILE"

    MAX_RETRY=3

    # ---- Stage 1 ----
    echo "" | tee -a "$LOG_FILE"
    echo "===== Stage 1: 主训练 300ep =====" | tee -a "$LOG_FILE"
    STAGE1_BEST=""
    for attempt in $(seq 1 $MAX_RETRY); do
        echo "[Stage1] 第 ${attempt} 次尝试..." | tee -a "$LOG_FILE"
        if CUDA_VISIBLE_DEVICES=$GPU_LIST torchrun \
            --nproc_per_node=$N_GPU \
            --master_port=$(python3 -c "import socket; s=socket.socket(); s.bind(('',0)); print(s.getsockname()[1]); s.close()") \
            train_stage1.py --batch $ACTUAL_BATCH --project "$PROJECT" --name stage1 \
            2>&1 | tee -a "$LOG_FILE"; then
            break
        fi
        echo "[Stage1] 失败, 30s 后重试..." | tee -a "$LOG_FILE"
        sleep 30
    done

    STAGE1_RESULT="$PROJECT/stage1/.stage1_result"
    if [ -f "$STAGE1_RESULT" ]; then
        STAGE1_BEST=$(cat "$STAGE1_RESULT")
        echo "[Stage1] best.pt = $STAGE1_BEST" | tee -a "$LOG_FILE"
    else
        echo "[ERROR] Stage 1 未产生 .stage1_result" | tee -a "$LOG_FILE"
        exit 1
    fi

    # 重新探测 GPU (其他用户可能已释放/占用)
    GPU_INFO=$(detect_gpus)
    GPU_LIST=$(echo "$GPU_INFO" | head -1)
    N_GPU=$(echo "$GPU_INFO" | tail -1)
    ACTUAL_BATCH=$(( (BATCH / N_GPU) * N_GPU ))

    # ---- Stage 2 ----
    echo "" | tee -a "$LOG_FILE"
    echo "===== Stage 2: 全分辨率精调 120ep =====" | tee -a "$LOG_FILE"
    STAGE2_BEST=""
    for attempt in $(seq 1 $MAX_RETRY); do
        echo "[Stage2] 第 ${attempt} 次尝试..." | tee -a "$LOG_FILE"
        if CUDA_VISIBLE_DEVICES=$GPU_LIST torchrun \
            --nproc_per_node=$N_GPU \
            --master_port=$(python3 -c "import socket; s=socket.socket(); s.bind(('',0)); print(s.getsockname()[1]); s.close()") \
            train_stage2.py --model "$STAGE1_BEST" --batch $ACTUAL_BATCH --project "$PROJECT" --name stage2 \
            2>&1 | tee -a "$LOG_FILE"; then
            break
        fi
        echo "[Stage2] 失败, 30s 后重试..." | tee -a "$LOG_FILE"
        sleep 30
    done

    STAGE2_RESULT="$PROJECT/stage2/.stage2_result"
    if [ -f "$STAGE2_RESULT" ]; then
        STAGE2_BEST=$(cat "$STAGE2_RESULT")
        echo "[Stage2] best.pt = $STAGE2_BEST" | tee -a "$LOG_FILE"
    else
        echo "[ERROR] Stage 2 未产生 .stage2_result" | tee -a "$LOG_FILE"
        exit 1
    fi

    # 重新探测 GPU
    GPU_INFO=$(detect_gpus)
    GPU_LIST=$(echo "$GPU_INFO" | head -1)
    N_GPU=$(echo "$GPU_INFO" | tail -1)
    ACTUAL_BATCH=$(( (BATCH / N_GPU) * N_GPU ))

    # ---- Stage 3 ----
    echo "" | tee -a "$LOG_FILE"
    echo "===== Stage 3: 极低 LR 抛光 60ep =====" | tee -a "$LOG_FILE"
    for attempt in $(seq 1 $MAX_RETRY); do
        echo "[Stage3] 第 ${attempt} 次尝试..." | tee -a "$LOG_FILE"
        if CUDA_VISIBLE_DEVICES=$GPU_LIST torchrun \
            --nproc_per_node=$N_GPU \
            --master_port=$(python3 -c "import socket; s=socket.socket(); s.bind(('',0)); print(s.getsockname()[1]); s.close()") \
            train_stage3.py --model "$STAGE2_BEST" --batch $ACTUAL_BATCH --project "$PROJECT" --name stage3 \
            2>&1 | tee -a "$LOG_FILE"; then
            break
        fi
        echo "[Stage3] 失败, 30s 后重试..." | tee -a "$LOG_FILE"
        sleep 30
    done

    # ---- Evaluate ----
    echo "" | tee -a "$LOG_FILE"
    echo "===== 最终评估 =====" | tee -a "$LOG_FILE"
    STAGE3_RESULT="$PROJECT/stage3/.stage3_result"
    if [ -f "$STAGE3_RESULT" ]; then
        FINAL_MODEL=$(cat "$STAGE3_RESULT")
    else
        FINAL_MODEL="$STAGE2_BEST"
    fi
    python evaluate.py --model "$FINAL_MODEL" 2>&1 | tee -a "$LOG_FILE"

    echo "" | tee -a "$LOG_FILE"
    echo "========================================" | tee -a "$LOG_FILE"
    echo "[$(date)] Pipeline 完成!" | tee -a "$LOG_FILE"
    echo "========================================" | tee -a "$LOG_FILE"
}

start_tmux() {
    if tmux has-session -t "$SESSION" 2>/dev/null; then
        echo "已在跑: tmux 会话 '$SESSION' 存在。用 '$0 attach' 或 '$0 tail' 查看。"
        exit 0
    fi
    tmux new -d -s "$SESSION" bash -lc "
        cd $DIR
        source $DIR/run_pipeline.bash _run_internal
    "
    echo "已用 tmux 启动三阶段 pipeline。会话: $SESSION"
    echo "  查看日志:  $0 tail"
    echo "  接入会话:  $0 attach (Ctrl-b d 退出)"
    echo "  停止训练:  $0 stop"
}

start_nohup() {
    if [[ -f "$PID_FILE" ]] && ps -p "$(cat "$PID_FILE")" >/dev/null 2>&1; then
        echo "已在跑: PID=$(cat "$PID_FILE")"
        exit 0
    fi
    nohup bash -lc "
        cd $DIR
        source $DIR/run_pipeline.bash _run_internal
    " > "$LOG_FILE" 2>&1 & echo $! > "$PID_FILE"
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
    if have_tmux && tmux has-session -t "$SESSION" 2>/dev/null; then
        echo "tmux 会话 '$SESSION' 正在运行"
    elif [[ -f "$PID_FILE" ]] && ps -p "$(cat "$PID_FILE")" >/dev/null 2>&1; then
        echo "nohup 运行中 PID=$(cat "$PID_FILE")"
    else
        echo "未发现运行中的 pipeline"
    fi
    echo "—— GPU ——"
    nvidia-smi --query-gpu=index,memory.used,memory.free,utilization.gpu --format=csv 2>/dev/null || true
    echo "—— 最新日志 ——"
    tail -5 "$LOG_FILE" 2>/dev/null || true
}

stop() {
    if have_tmux && tmux has-session -t "$SESSION" 2>/dev/null; then
        tmux send-keys -t "$SESSION" C-c
        sleep 3
        tmux kill-session -t "$SESSION" 2>/dev/null || true
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
    pkill -f "torch.distributed.run" 2>/dev/null || true
    pkill -f "train_stage" 2>/dev/null || true
    echo "已停止"
}

tail_log() {
    [[ -f "$LOG_FILE" ]] || { echo "日志不存在: $LOG_FILE"; exit 1; }
    tail -f "$LOG_FILE"
}

attach() {
    have_tmux || { echo "无 tmux"; exit 1; }
    tmux has-session -t "$SESSION" 2>/dev/null || { echo "会话不存在"; exit 1; }
    tmux attach -t "$SESSION"
}

usage() {
    cat <<EOF
用法: $0 {start|status|stop|tail|attach}
  start   启动三阶段训练 pipeline (tmux 优先, 关电脑不影响)
  status  查看运行状态 + GPU
  stop    停止训练
  tail    实时看日志
  attach  接入 tmux 会话 (Ctrl-b d 退出)
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
