#!/usr/bin/env bash
# =============================================================================
# Download DAVIS 2017 (Densely Annotated Video Segmentation)
# Dataset page: https://davischallenge.org/davis2017/code.html
#
# DAVIS 2017 trainval (480p) — ~2.5 GB
# Contains 90 video sequences with dense pixel-level annotations.
# Perfect for Phase 1 pre-training of SiamMask-Lite.
#
# Usage:
#   bash scripts/download_davis.sh
# =============================================================================

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="$SCRIPT_DIR/../data/DAVIS"

echo "=== DAVIS 2017 Download ==="
echo "Target directory: $DATA_DIR"
mkdir -p "$DATA_DIR"

# ── Download DAVIS 2017 trainval 480p ──────────────────────────────────────
DAVIS_URL="https://data.vision.ee.ethz.ch/csergi/share/davis/DAVIS-2017-trainval-480p.zip"
DAVIS_ZIP="$DATA_DIR/DAVIS-2017-trainval-480p.zip"

if [ ! -f "$DAVIS_ZIP" ]; then
    echo "[1/3] Downloading DAVIS 2017 trainval 480p (~2.5GB)..."
    wget --progress=bar:force -O "$DAVIS_ZIP" "$DAVIS_URL"
else
    echo "[1/3] DAVIS zip already present, skipping download."
fi

# ── Extract ────────────────────────────────────────────────────────────────
if [ ! -d "$DATA_DIR/JPEGImages" ]; then
    echo "[2/3] Extracting..."
    unzip -q "$DAVIS_ZIP" -d "$DATA_DIR"
    # DAVIS extracts to DAVIS/JPEGImages and DAVIS/Annotations
    # Move up one level if nested
    if [ -d "$DATA_DIR/DAVIS/JPEGImages" ]; then
        mv "$DATA_DIR/DAVIS/JPEGImages" "$DATA_DIR/"
        mv "$DATA_DIR/DAVIS/Annotations" "$DATA_DIR/"
        mv "$DATA_DIR/DAVIS/ImageSets" "$DATA_DIR/" 2>/dev/null || true
        rmdir "$DATA_DIR/DAVIS" 2>/dev/null || true
    fi
    echo "  Extracted."
else
    echo "[2/3] Already extracted, skipping."
fi

# ── Verify structure ───────────────────────────────────────────────────────
echo "[3/3] Verifying structure..."
JPEG_COUNT=$(find "$DATA_DIR/JPEGImages" -name "*.jpg" 2>/dev/null | wc -l)
MASK_COUNT=$(find "$DATA_DIR/Annotations" -name "*.png" 2>/dev/null | wc -l)
VIDEO_COUNT=$(ls "$DATA_DIR/JPEGImages/480p/" 2>/dev/null | wc -l)

echo "  Videos:  $VIDEO_COUNT"
echo "  Images:  $JPEG_COUNT"
echo "  Masks:   $MASK_COUNT"

# ── Download ImageSets (train/val split lists) ─────────────────────────────
IMAGESET_URL="https://data.vision.ee.ethz.ch/csergi/share/davis/DAVIS-2017-trainval-480p.zip"

echo ""
echo "=== DAVIS download complete ==="
echo "Structure:"
echo "  data/DAVIS/"
echo "  ├── JPEGImages/480p/<video>/*.jpg"
echo "  └── Annotations/480p/<video>/*.png"
echo ""
echo "Pass to trainer as:"
echo "  --vos-root data/DAVIS"
echo ""

# Cleanup zip to save space (optional)
read -p "Delete zip file to save ~2.5GB? [y/N] " -r
if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -f "$DAVIS_ZIP"
    echo "Zip deleted."
fi
