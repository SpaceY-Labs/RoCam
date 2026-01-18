#!/usr/bin/env bash
set -euo pipefail

# ----------------------------
# Defaults (DeepStream-aligned)
# ----------------------------
DATA_YAML="${DATA_YAML:-$HOME/bm/testdata/data_15000/data.yaml}"
SPLIT="${SPLIT:-val}"
ENGINE="${ENGINE:-$HOME/bm/backend/cv_process/model_b1_gpu0_fp16.engine}"

STAGE_MODE="${STAGE_MODE:-letterbox}"
BBOX_SOURCE="${BBOX_SOURCE:-detector}"
IMAGE_ID_MODE="${IMAGE_ID_MODE:-seq}"

CONF="${CONF:-0.25}"
NMS_IOU="${NMS_IOU:-0.45}"
DEBUG_VIS="${DEBUG_VIS:-20}"

PYTHON="${PYTHON:-python3}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="${SCRIPT:-$SCRIPT_DIR/accuracy_benchmark.py}"

usage() {
  cat <<EOF
Usage:
  $(basename "$0") [options] [-- extra_args_to_accuracy_benchmark]

Options:
  --data-yaml PATH     (default: $DATA_YAML)
  --split val|test     (default: $SPLIT)
  --engine PATH        (default: $ENGINE)

  --conf FLOAT         (default: $CONF)
  --nms-iou FLOAT       (default: $NMS_IOU)
  --debug-vis INT      (default: $DEBUG_VIS)

  --script PATH        accuracy_benchmark.py path (default: $SCRIPT)
  --python CMD         python cmd (default: $PYTHON)

Examples:
  ./$(basename "$0")
  ./$(basename "$0") --engine /path/to/model.engine
  ./$(basename "$0") --split test --debug-vis 50
  ./$(basename "$0") -- --dump-json /tmp/dets.json
EOF
}

# ----------------------------
# Parse args
# ----------------------------
EXTRA_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --data-yaml) DATA_YAML="$2"; shift 2 ;;
    --split) SPLIT="$2"; shift 2 ;;
    --engine) ENGINE="$2"; shift 2 ;;
    --conf) CONF="$2"; shift 2 ;;
    --nms-iou) NMS_IOU="$2"; shift 2 ;;
    --debug-vis) DEBUG_VIS="$2"; shift 2 ;;
    --script) SCRIPT="$2"; shift 2 ;;
    --python) PYTHON="$2"; shift 2 ;;
    --) shift; EXTRA_ARGS+=("$@"); break ;;
    *) EXTRA_ARGS+=("$1"); shift ;;
  esac
done

# ----------------------------
# Sanity checks
# ----------------------------
command -v "$PYTHON" >/dev/null 2>&1 || { echo "[ERR] python not found: $PYTHON" >&2; exit 1; }
[[ -f "$SCRIPT" ]] || { echo "[ERR] accuracy_benchmark.py not found: $SCRIPT" >&2; exit 1; }
[[ -f "$DATA_YAML" ]] || { echo "[ERR] data.yaml not found: $DATA_YAML" >&2; exit 1; }
[[ -f "$ENGINE" ]] || { echo "[ERR] engine not found: $ENGINE" >&2; exit 1; }

echo "[INFO] Running accuracy benchmark (DeepStream-aligned)"
echo "  data-yaml:   $DATA_YAML"
echo "  split:      $SPLIT"
echo "  engine:     $ENGINE"
echo "  conf:       $CONF"
echo "  nms-iou:    $NMS_IOU"
echo "  debug-vis:  $DEBUG_VIS"
echo

exec "$PYTHON" "$SCRIPT" \
  --data-yaml "$DATA_YAML" \
  --split "$SPLIT" \
  --engine "$ENGINE" \
  --stage-mode "$STAGE_MODE" \
  --bbox-source "$BBOX_SOURCE" \
  --image-id-mode "$IMAGE_ID_MODE" \
  --conf "$CONF" \
  --nms-iou "$NMS_IOU" \
  --debug-vis "$DEBUG_VIS" \
  "${EXTRA_ARGS[@]}"
