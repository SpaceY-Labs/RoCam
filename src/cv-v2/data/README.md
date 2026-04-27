# Training Data Directory

This folder is **gitignored** — datasets are downloaded locally only. Models trained on Grace expect the same layout.

## Expected Structure

```
data/
├── DAVIS/                       # DAVIS 2017 (~2.5GB, auto-download)
│   ├── JPEGImages/480p/<video>/00000.jpg ...
│   ├── Annotations/480p/<video>/00000.png   (palette PNG, value > 0 = object id)
│   └── ImageSets/2017/{train,val}.txt
│
├── youtube-vos/                 # YouTube-VOS 2019 (~20GB, requires registration)
│   └── train/
│       ├── JPEGImages/<video_id>/00000.jpg ...
│       └── Annotations/<video_id>/<frame>.png
│
└── rockets-masks/               # Optional - only if Stage 2 is run
    ├── train/
    │   ├── JPEGImages/<seq>/ *.jpg
    │   └── Annotations/<seq>/ *.png
    └── val/
        ├── JPEGImages/
        └── Annotations/
```

`rockets/` (YOLO bbox-only data) is optional input to `scripts/prepare_domain_masks.py`, which generates `rockets-masks/` from bboxes.

## Schema Consumed by `MaskTrackNet`

`data/dataset.py` produces dicts with float32 tensors:

| Key | Shape | Range |
|---|---|---|
| `reference_image` | (3, H, W) | [0, 1] RGB |
| `reference_mask`  | (1, H, W) | binary {0, 1} |
| `target_image`    | (3, H, W) | [0, 1] RGB |
| `target_mask`     | (1, H, W) | binary {0, 1} |

H == W, multiple of 32. Sampled per-iteration from a stage-specific multi-scale list (Stage 1: 384-640, Stage 2: 768-1024).

## Quick Setup

**Linux/macOS (bash):**
```bash
cd src/cv-v2
bash scripts/download_davis.sh
bash scripts/download_youtube_vos.sh --kaggle
```

(If `download_*.sh` scripts are not present in `scripts/`, run on Grace where DAVIS/YT-VOS will be staged manually before Stage 1 kickoff.)

## Mask Annotation (Stage 2 Only - Optional)

DAVIS and YT-VOS already ship pixel-perfect masks; **no labelling work needed for Stage 1**. Stage 2 is the only path that needs new mask data, and only if a per-domain fine-tune is run.

For rocket footage (only Stage 2 use case as of writing):

- **Bbox->rectangle pseudo-masks (default).** `python scripts/prepare_domain_masks.py --bbox-mode rectangle` converts existing YOLO bboxes to filled rectangle masks. Cheap, instant.
- **SAM-assisted (upgrade).** `python scripts/prepare_domain_masks.py --sam --sam-checkpoint sam_vit_b.pth`. ~1-2s/image on H100.
- **Manual (val split).** Use CVAT (https://www.cvat.ai/) or LabelMe for ~500 frames of held-out val data.
