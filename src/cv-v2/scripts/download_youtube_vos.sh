#!/usr/bin/env bash
# =============================================================================
# Download YouTube-VOS 2019 (Video Object Segmentation)
# Dataset page: https://youtube-vos.org/dataset/vos/
#
# YouTube-VOS is the largest VOS dataset: 3,471 train videos, 65+ object cats.
# REQUIRED for Phase 1 pre-training — gives the model general object matching.
#
# ⚠️  REQUIRES REGISTRATION:
#     1. Go to https://codalab.lisn.upsaclay.fr/competitions/7685
#     2. Register / sign in
#     3. Go to "Participate" → "Get Data"
#     4. Download the train.zip (or use the link below after registering)
#
# Alternatively, use the Kaggle mirror (no registration):
#     https://www.kaggle.com/datasets/aruchomu/youtube-vos
#     kaggle datasets download -d aruchomu/youtube-vos
#
# Usage:
#   # Option A: Provide your own downloaded zip:
#   bash scripts/download_youtube_vos.sh --zip /path/to/train.zip
#
#   # Option B: Kaggle (must have kaggle CLI configured):
#   bash scripts/download_youtube_vos.sh --kaggle
#
#   # Option C: Direct download (if you have the cookie/token from CodaLab):
#   bash scripts/download_youtube_vos.sh --url "https://your-signed-url"
# =============================================================================

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="$SCRIPT_DIR/../data/youtube-vos"

ZIP_PATH=""
USE_KAGGLE=false
DIRECT_URL=""

# Parse args
while [[ $# -gt 0 ]]; do
    case "$1" in
        --zip)   ZIP_PATH="$2"; shift 2 ;;
        --kaggle) USE_KAGGLE=true; shift ;;
        --url)   DIRECT_URL="$2"; shift 2 ;;
        *) echo "Unknown arg: $1"; exit 1 ;;
    esac
done

echo "=== YouTube-VOS 2019 Setup ==="
echo "Target directory: $DATA_DIR"
mkdir -p "$DATA_DIR/train"

# ── Option A: User-provided zip ────────────────────────────────────────────
if [ -n "$ZIP_PATH" ]; then
    echo "[1/3] Using provided zip: $ZIP_PATH"
    echo "[2/3] Extracting (~15-20GB, takes a few minutes)..."
    unzip -q "$ZIP_PATH" -d "$DATA_DIR"
    echo "  Extracted."

# ── Option B: Kaggle download ──────────────────────────────────────────────
elif [ "$USE_KAGGLE" = true ]; then
    if ! command -v kaggle &> /dev/null; then
        echo "ERROR: kaggle CLI not found."
        echo "Install: pip install kaggle"
        echo "Setup:   https://www.kaggle.com/docs/api"
        exit 1
    fi
    echo "[1/3] Downloading via Kaggle (~20GB)..."
    kaggle datasets download -d aruchomu/youtube-vos -p "$DATA_DIR" --unzip
    echo "  Downloaded and extracted."

# ── Option C: Direct URL ───────────────────────────────────────────────────
elif [ -n "$DIRECT_URL" ]; then
    ZIP_FILE="$DATA_DIR/youtube-vos-train.zip"
    echo "[1/3] Downloading from URL (~20GB)..."
    wget --progress=bar:force -O "$ZIP_FILE" "$DIRECT_URL"
    echo "[2/3] Extracting..."
    unzip -q "$ZIP_FILE" -d "$DATA_DIR"
    echo "  Extracted."
    rm -f "$ZIP_FILE"

# ── No source provided ─────────────────────────────────────────────────────
else
    echo ""
    echo "╔══════════════════════════════════════════════════════════════════╗"
    echo "║         YouTube-VOS requires manual download (registration)     ║"
    echo "╠══════════════════════════════════════════════════════════════════╣"
    echo "║                                                                  ║"
    echo "║  Option 1: CodaLab (official, free registration)                ║"
    echo "║    1. Go to: https://codalab.lisn.upsaclay.fr/competitions/7685 ║"
    echo "║    2. Click 'Participate' → 'Get Data'                          ║"
    echo "║    3. Download train.zip                                         ║"
    echo "║    4. Run: bash scripts/download_youtube_vos.sh --zip train.zip  ║"
    echo "║                                                                  ║"
    echo "║  Option 2: Kaggle (easier, no registration needed)              ║"
    echo "║    1. pip install kaggle                                         ║"
    echo "║    2. Set up ~/.kaggle/kaggle.json                               ║"
    echo "║    3. Run: bash scripts/download_youtube_vos.sh --kaggle         ║"
    echo "║                                                                  ║"
    echo "║  Option 3: Skip YouTube-VOS, use DAVIS only                     ║"
    echo "║    DAVIS alone gives decent pre-training (90 videos).            ║"
    echo "║    YouTube-VOS adds 3,471 more videos but is optional.          ║"
    echo "║                                                                  ║"
    echo "╚══════════════════════════════════════════════════════════════════╝"
    echo ""
    exit 0
fi

# ── Normalize directory structure ──────────────────────────────────────────
# YouTube-VOS extracts to: train/JPEGImages/<video>/ and train/Annotations/<video>/
# We want: data/youtube-vos/train/JPEGImages/ and data/youtube-vos/train/Annotations/
echo "[3/3] Verifying structure..."

JPEG_DIR=""
for candidate in \
    "$DATA_DIR/train/JPEGImages" \
    "$DATA_DIR/JPEGImages" \
    "$DATA_DIR/train/train/JPEGImages"; do
    if [ -d "$candidate" ]; then
        JPEG_DIR="$candidate"
        break
    fi
done

if [ -z "$JPEG_DIR" ]; then
    echo "WARNING: Could not find JPEGImages directory."
    echo "Expected: data/youtube-vos/train/JPEGImages/<video_id>/"
    echo "Please check the extracted structure manually."
    ls "$DATA_DIR/"
else
    VIDEO_COUNT=$(ls "$JPEG_DIR" | wc -l)
    FRAME_COUNT=$(find "$JPEG_DIR" -name "*.jpg" | wc -l)
    echo "  Videos: $VIDEO_COUNT"
    echo "  Frames: $FRAME_COUNT"
    echo ""
    echo "=== YouTube-VOS download complete ==="
    echo "Structure:"
    echo "  data/youtube-vos/"
    echo "  └── train/"
    echo "      ├── JPEGImages/<video_id>/*.jpg"
    echo "      └── Annotations/<video_id>/*.png"
    echo ""
    echo "Pass to trainer as:"
    echo "  --vos-root data/youtube-vos/train"
fi
