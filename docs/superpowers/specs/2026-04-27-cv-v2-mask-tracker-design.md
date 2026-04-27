# cv-v2: Class-Agnostic Mask-Conditioned Tracker ("Track Anything") — Design Spec

**Status:** Draft for review
**Date:** 2026-04-27
**Author:** Shike Chen
**Code location:** `src/cv-v2/`
**Relationship to v1:** cv-v2 is a different task, not a successor of the same task. v1 (`src/CV/`) is a single-class YOLOv26 *detector* trained to find rockets. cv-v2 is a *class-agnostic mask-conditioned tracker* that can follow any object the user masks once — rockets are not its native vocabulary, they are just one of infinitely many possible targets.

---

## 1. Goal

Train a **class-agnostic, mask-conditioned segmentation model** — given a reference image with the target masked plus a target image, predict the target's mask in the target image. The model has no notion of "rocket" or any other class; it tracks whatever the user masks.

The headline use case is generic ("user clicks/draws a mask on any object → camera follows it"). Rocket footage is one possible fine-tune domain, *not* a target class. The Stage-1-only model (trained on YouTube-VOS + DAVIS) is the primary deliverable: a tracker that works on cars, animals, drones, balls, people, rockets, or anything else with a clear visual boundary in a video.

**Inputs**

- `reference_image`: RGB image, 3 channels.
- `reference_mask`: binary mask on the reference image, 1 channel. Marks the target.
- `target_image`: RGB image, 3 channels. The frame in which to find the target.

**Output**

- `target_mask`: predicted binary mask of the target in the target image, 1 channel, same H×W as `target_image`.

## 2. Non-goals

- **No bounding-box head.** Bbox is derived post-hoc from the predicted mask (`mask → tight bbox`).
- **No presence/score head.** Confidence is derived from `mean(sigmoid(logits))` over predicted-positive pixels at deploy time.
- **No memory-network conditioning** (STM/STCN/XMem-style). Pure pairwise model. Memory networks deferred to a possible v3.
- **No multi-object simultaneous tracking** in a single forward pass. One target per call. Multi-object is handled at the orchestration layer by running the model once per target.
- **No deployment-pipeline work in this spec.** Inference target hardware, DeepStream integration, INT8/FP16 quantization, and gimbal-control wiring are out of scope. The model is designed to be FCN and resolution-agnostic so deployment can be specced separately.
- **No new labelling-app work.** Mask annotation tooling reuses existing scripts and external tools (CVAT, SAM-assisted labelling) as already documented in `src/cv-v2/data/README.md`.

## 3. Architecture: `MaskTrackNet`

A two-stream Siamese CNN with depthwise cross-correlation fusion and an FPN-style mask decoder. Pure CNN, no attention, no transformer blocks.

### 3.1 Diagram

```
                                           shared weights
   Reference image (3, H, W)                       │
   Reference mask  (1, H, W)  ─concat─► (4, H, W) ──►  Stem-4ch (4→32, stride 2, conv3x3)
                                                          │
                                                          ▼
                                                   YOLO26-mini Backbone
                                                   ├─ Stage 1: stride 4   C2f, 32→64
                                                   ├─ Stage 2: stride 8   C2f, 64→128
                                                   ├─ Stage 3: stride 16  C2f, 128→256
                                                   └─ Stage 4: stride 32  C2f + SPPF, 256→256
                                                          │ (taps at s4, s8, s16)
                                                          ▼
                                                  f_ref @ stride 16  (256, H/16, W/16)

   Target image (3, H, W)  ──► Stem-3ch (3→32, stride 2, conv3x3)
                                                          │
                                                          ▼  (shared backbone weights from stage 1 onward)
                                                  f_tgt @ stride 16  (256, H/16, W/16)
                                                  + skips at s2, s4, s8

   ┌──────────────────────── Fusion ─────────────────────────┐
   │  Adaptive avg-pool f_ref  →  (256, k, k) kernel,  k = 5  │
   │  Depthwise correlation:  fused = DWConv(f_tgt, kernel)   │
   │  1×1 conv + GN + SiLU  →  (256, H/16, W/16)              │
   └──────────────────────────────────────────────────────────┘
                                                          │
                                                          ▼
                                              FPN-style Mask Decoder
                                              (Up + 3×3 conv + GN + SiLU per stage)
                                              ├─ s16 → s8   skip from target stage 2
                                              ├─ s8  → s4   skip from target stage 1
                                              ├─ s4  → s2   skip from target stem
                                              └─ s2  → s1   1×1 conv → (1, H, W) logits
                                                          │
                                                          ▼
                                              sigmoid → predicted mask (1, H, W)
```

### 3.2 Backbone — YOLO26-mini

- Adapted from YOLOv26s, scaled down by capping channel width at 256 (vs ~512 in YOLO26s' deep stages) and dropping the P5 detection feature path that won't be used.
- Four C2f stages preserved (satisfies `goal.md` "≥4 CNN layers"). All stages use C2f blocks + SiLU + BN, identical structure to YOLOv26.
- Two stems (4-channel for reference, 3-channel for target). All weights from stage 1 onward are shared between the two streams.
- No detection head, no DFL, no class branch.
- **Trained from scratch.** No warm-start from the v1 v3_phase2 checkpoint.

### 3.3 Fusion — depthwise cross-correlation

- Reference stride-16 features `f_ref` are global-avg-pooled to a `(256, k, k)` kernel with k=5.
- Depthwise convolution of the target stride-16 feature map with that kernel.
- Followed by a `1×1 conv → GroupNorm(32 groups) → SiLU` to remix channels.
- Output stays at `(256, H/16, W/16)` and feeds the decoder.

### 3.4 Decoder — lightweight FPN

- Four upsample blocks: bilinear ×2 → 3×3 conv → GN → SiLU.
- Each block fuses a skip connection from the target branch at the matching stride.
- Final 1×1 conv produces 1-channel logits at full input resolution.
- ~2.5M params.

### 3.5 Parameter budget

Approximate, will be verified with `fvcore.nn.FlopCountAnalysis` once implemented.

| Block | Params |
|---|---|
| Stems (4ch + 3ch, stage 1+ shared) | ~0.05M |
| Backbone stages 1–4 | ~6.0M |
| Fusion (DW corr + 1×1 + GN) | ~0.3M |
| FPN decoder | ~2.5M |
| **Total target** | **~9.0M** |
| **Suggested upper bound (per `goal.md`)** | **~20M** |

The 10M target / 20M upper bound from `goal.md` is treated as a guideline, not a hard constraint. If a design choice (e.g., a wider decoder, k=7 fusion kernel, or an extra FPN stage) materially improves accuracy and pushes the count to 12–15M, that's acceptable. Anything that would push the count past 20M needs explicit justification in the implementation plan.

### 3.6 Resolution behavior

- Fully convolutional. No fixed-size layers, no positional embeddings, no global pooling that breaks spatial dims.
- **GroupNorm** is used everywhere a normalization layer is needed (replacing the BatchNorm that YOLOv26 uses). Reason: GN is resolution-agnostic and removes BN running-stat fragility under the small batch sizes Stage 2 will use.
- Stride-32 deepest path means input H,W must be multiples of 32. Inference inputs are pad-to-multiple-of-32 and cropped at output.
- The two branches are independent forward passes that meet only at fusion, so reference and target may run at different resolutions (e.g., reference at 256×256, target at 1920×1088).

## 4. Data pipeline

### 4.1 Sources

| Source | Status | Role |
|---|---|---|
| YouTube-VOS 2019 train (3,471 videos) | Downloaded under `src/cv-v2/data/youtube-vos/train/`. Ships with pixel-perfect mask annotations (no further labelling needed). | Stage 1 pretraining (primary) |
| DAVIS 2017 trainval (65 videos) | Downloaded under `src/cv-v2/data/DAVIS/`. Ships with pixel-perfect mask annotations (no further labelling needed). | Stage 1 pretraining + held-out eval (val split) |
| `rockets-masks/` (mask-annotated rocket footage) | **Empty.** Train and val subdirs exist but contain no data. | Stage 2 fine-tune. Conditional — only runs if rocket masks are produced. |
| `rockets/` (YOLO bbox-only) | **Empty.** Subdirs exist | Source frames + bboxes that can be converted to pseudo-masks if the rocket fine-tune is desired |

### 4.2 Replacement of existing `dataset.py`

The current `src/cv-v2/data/dataset.py` produces `(template_127, search_255, gt_mask, gt_bbox, gt_present)` for a SiamMask-style architecture. That schema does not fit MaskTrackNet's I/O. The dataset module is rewritten, not adapted.

**New training sample schema (per pair):**

```python
{
    "reference_image": Tensor (3, H, W),    # RGB, normalized to [0, 1]
    "reference_mask":  Tensor (1, H, W),    # binary {0, 1}
    "target_image":    Tensor (3, H, W),    # RGB, normalized to [0, 1]
    "target_mask":     Tensor (1, H, W),    # binary {0, 1}, ground truth
}
```

H and W are sampled per iteration from a multi-scale list (see §5.2), are equal within a pair, and are multiples of 32.

### 4.3 Sampling logic

For each training sample:

1. Pick a video uniformly at random.
2. Pick an object id present in ≥2 annotated frames.
3. Pick two annotated frames `(t_ref, t_tgt)` with temporal gap drawn from `Uniform[1, max_gap]`. `max_gap = 30` for YT-VOS, `15` for DAVIS (shorter videos).
4. Crop a context-padded square around the object's bbox in both frames. Context factor 2.5× the object's max side, jittered ±20% in scale and ±15% in translation independently per frame.
5. Resize both crops to the iteration's sampled `H×W`.
6. Apply photometric augmentation (color jitter, ±5% gray, horizontal flip with mask flipped accordingly) and **random rotation** (Stage 1: ±15°, Stage 2: ±20°; bilinear for image, nearest for mask, zero-pad border) to each crop independently. Reference and target rotate independently so the model learns rotation-invariant matching rather than a temporally-correlated rotation prior.
7. Compute `reference_mask` as `(annotation == object_id)` from the reference frame; same for `target_mask` in the target frame.

**Negative-pair augmentation (10% of samples):** with probability 0.1, the reference is replaced by a random object from a *different* video. `target_mask` is forced to all-zero. This teaches the model to predict empty masks when the reference does not appear in the target image — important for the deployment case where the gimbal loses the rocket and the tracker must report "absent" via low mask confidence.

### 4.4 Rocket data preparation (only if Stage 2 is run)

DAVIS and YT-VOS ship with pixel-perfect mask annotations, so Stage 1 needs no labelling work. Stage 2 is the only stage that needs new mask data, because the v1 rocket dataset is YOLO-bbox only — no pixel masks. Three options for producing rocket masks, in increasing labelling cost:

1. **Bbox→rectangle pseudo-masks.** Convert each YOLO bbox to a filled rectangle. Cheap, instant, no extra tooling. Quality is poor for shape but fine for "where is the rocket" — adequate if the rocket fine-tune is just about adapting to the visual domain (sky background, motion blur, low-resolution targets) rather than learning fine mask shape.
2. **SAM-assisted pseudo-masks.** `segment-anything` ViT-B, prompted with each existing YOLO bbox, produces tight pixel masks. ~1–2 s/image on H100; on ~30k frames that's 8–17 GPU-hours upfront. No human time required.
3. **Manual labelling.** Highest quality, highest cost. Reserve for a held-out val split (~500 frames is enough for evaluation).

Recommended default: (1) for the bulk of training data + (3) for the val split. (2) is an upgrade path if (1) caps Stage 2 mIoU below the acceptance threshold.

If Stage 2 isn't worth the labelling cost yet, **ship the Stage-1-only model as cv-v2** and treat rocket fine-tune as a follow-up. The acceptance criteria below distinguish the two cases.

The data-prep scripts go under `src/cv-v2/scripts/`. They are idempotent and do not block on completion of subsequent training stages.

### 4.5 Eval data

- **Primary eval:** DAVIS-2017 val split (single-object protocol). Standard J&F metric.
- **Domain eval:** held-out rocket-masks val split. Custom IoU + per-frame mask Dice.
- No YT-VOS eval. YT-VOS validation requires server-side evaluation; not worth the workflow cost when DAVIS J&F gives the same signal.

## 5. Training schedule

Two-stage curriculum, mirroring the V3 detector's "strong-aug pretrain → gentle-aug fine-tune" pattern.

### 5.1 Hardware regime

- Single H100 80GB on McMaster Grace.
- Single-GPU training, gradient accumulation to hit a larger effective batch (`nbs`). No DDP — V3 documented that DDP/single-GPU regime switches caused a measurable accuracy regression, so the cv-v2 schedule starts and ends single-GPU for consistency.
- AMP (BF16) on. Mixed precision is safe with GroupNorm (no BN running-stat issues).

### 5.2 Multi-scale training

Per iteration, sample input `H×W` (square) from a stage-specific list:

- Stage 1: `{384, 448, 512, 576, 640}` — uniform random per iteration.
- Stage 2: `{768, 832, 896, 960, 1024}` — uniform random per iteration.

Multi-scale broadens the deployment-resolution envelope without requiring separate model variants. Costs ~10% wall-time vs single-resolution training.

### 5.3 Stage 1 — VOS pretraining

| Parameter | Value |
|---|---|
| Data | YT-VOS train + DAVIS-2017 train (excluding DAVIS val for held-out eval) |
| Sampler | `ConcatDataset`, weighted toward YT-VOS by 5:1 (since YT-VOS is ~50× larger) |
| Resolution | Multi-scale 384–640 (see §5.2) |
| Epochs | 80 |
| Batch (per-iter) | 16 at 512; auto-scaled by resolution to keep activation VRAM within ~50 GB |
| `nbs` (effective batch via grad-accum) | 64 |
| Optimizer | AdamW |
| `lr0` | 3e-4 |
| `lrf` | 0.05 → cosine decay to 1.5e-5 |
| Weight decay | 0.05 |
| Warmup | 3 epochs, linear from 0 to `lr0` |
| Loss | `1.0 * BCEWithLogits + 1.0 * Dice` (per-pixel, averaged over batch) |
| Negative-pair ratio | 10% |
| Augmentation | Color jitter (brightness ±0.3, contrast ±0.3, saturation ±0.4), horizontal flip 0.5, random gray 0.05, scale jitter ±20%, translate jitter ±15%, rotation ±15° (independent per ref/tgt) |
| Checkpoint cadence | Every 5 epochs + best-on-DAVIS-val J&F |
| Eval cadence | DAVIS val J&F every 5 epochs |
| Patience | 0 (run all 80 epochs; let cosine schedule finish) |

### 5.4 Stage 2 — domain fine-tune (optional)

Stage 1 produces the class-agnostic shippable model. Stage 2 is an *optional* domain-adaptation experiment for any specific footage type the user wants extra accuracy on. The first such domain is rocket footage (sky background, very small targets, motion blur), since that data exists from the v1 detector pipeline. Other domains (cars, drones, etc.) can be added later by repeating the same procedure on their respective data.

If Stage 2 is skipped (or the chosen domain's data isn't ready), the Stage 1 best-on-DAVIS-val checkpoint is the shipped cv-v2 model.

| Parameter | Value |
|---|---|
| Data | `rockets-masks/train` (using whichever mask source from §4.4 was chosen) |
| Resolution | Multi-scale 768–1024 (see §5.2) |
| Epochs | 40 |
| Batch (per-iter) | 4 at 960; auto-scaled by resolution |
| `nbs` (effective batch) | 32 (grad-accum 8 at 960) |
| Optimizer | AdamW |
| `lr0` | 1e-4 (3× lower than Stage 1) |
| `lrf` | 0.1 → cosine decay |
| Weight decay | 0.05 |
| Warmup | 1 epoch |
| Loss | `1.0 * BCEWithLogits + 1.0 * Dice + 0.5 * BoundaryDice` — adds a boundary-only Dice term to sharpen mask edges, which matters for distant small rockets |
| Negative-pair ratio | 5% |
| Augmentation | Stage-1 augmentations + 30% random erasing (matches V3 detector) + 10% motion blur + rotation widened to ±20° |
| Patience | 15 epochs on val Dice |
| Initialization | Stage 1 best-on-DAVIS-val checkpoint |

### 5.5 Loss functions

```python
# Per-pixel binary cross-entropy
L_bce = BCEWithLogitsLoss(reduction="mean")(logits, gt_mask)

# Dice loss (handles class imbalance; rockets cover <1% of pixels)
def dice_loss(logits, gt, eps=1e-6):
    p = sigmoid(logits)
    num = 2 * (p * gt).sum(dim=(2, 3))
    den = (p + gt).sum(dim=(2, 3)) + eps
    return (1 - num / den).mean()

# Boundary Dice (Stage 2 only): apply Dice on the boundary band
# computed from gt_mask via morphological gradient.
def boundary_dice_loss(logits, gt, dilation=3):
    edge = morph_grad(gt, dilation)  # 1 if pixel within `dilation` of mask boundary
    p = sigmoid(logits)
    return dice_loss(logits * edge, gt * edge)

L_total = w_bce * L_bce + w_dice * dice_loss(logits, gt) + w_boundary * boundary_dice_loss(...)
```

Default weights: `w_bce = 1.0`, `w_dice = 1.0`, `w_boundary = 0.0` (Stage 1) → `0.5` (Stage 2).

## 6. Evaluation

### 6.1 Metrics

| Metric | Where | What it measures |
|---|---|---|
| **J** (region similarity) | DAVIS val | Mean IoU between predicted and gt mask, per frame, averaged over sequence |
| **F** (boundary F-measure) | DAVIS val | F1 of predicted vs gt mask boundaries with a tolerance of 0.008 × diag |
| **J&F** | DAVIS val | `(J + F) / 2`. Headline VOS metric. |
| **mIoU** | rockets-masks val | Mean per-frame IoU |
| **Mask Dice** | rockets-masks val | Per-frame Dice |
| **Latency** | n/a in this spec | Deferred to deployment spec |

### 6.2 Inference modes for evaluation

Both modes share weights; only the eval loop differs.

- **Mode A: fixed reference (one-shot).** Reference = frame 0 + frame-0 mask. All later frames segmented against this fixed reference.
- **Mode B: previous-frame propagation.** At frame `t`, reference = frame `t-1` + predicted mask `t-1`. First-frame seed is gt mask.

Report J&F under both modes for every checkpoint that crosses a "best so far" threshold. Pick the deployed checkpoint based on the stronger mode for the use case (Mode A for short sequences, Mode B for long sequences with appearance change).

### 6.3 Success criteria

- **Stage 1 acceptance (mandatory; defines whether cv-v2 ships):** DAVIS-2017 val **J&F ≥ 0.65** under Mode A. (For reference, SiamMask original paper reports ~0.55 J&F on DAVIS-2017; STM/STCN reach 0.85+ with memory networks. 0.65 is realistic for a 9M-param pure-CNN pairwise model.) This is a class-agnostic metric — DAVIS contains 30 diverse object categories.
- **Stage 2 acceptance (only if a domain fine-tune is run):** for the chosen domain, val **mIoU ≥ 0.70** under Mode A, and Mode B mIoU within 0.05 of Mode A on sequences <100 frames. The rocket fine-tune, if run, uses `rockets-masks/val` for this measurement.
- **Default ship plan:** Stage 1 best checkpoint is the cv-v2 deliverable. Stage 2 is a future enhancement, not a release blocker.
- **Param count:** Final model targeting ~10M params; ~20M is the suggested upper bound per `goal.md` rather than a hard cap. Anything beyond 20M needs explicit justification.

If Stage 1 misses the J&F target by more than 0.05, root-cause before starting Stage 2 — likely candidates are insufficient negative-pair ratio, decoder under-capacity, or fusion-kernel size.

## 7. File layout

```
src/cv-v2/
├── data/
│   ├── dataset.py                # rewritten: produces (ref_img, ref_mask, tgt_img, tgt_mask)
│   ├── augmentations.py          # photometric + geometric augmentations
│   ├── samplers.py               # multi-scale + weighted-concat sampling
│   ├── DAVIS/                    # downloaded
│   ├── youtube-vos/              # downloaded
│   ├── rockets/                  # YOLO-format raw frames + bbox labels (TBD)
│   ├── rockets-masks/            # mask-annotated rocket data (TBD)
│   └── README.md                 # update to reflect new schema
│
├── models/
│   ├── __init__.py
│   ├── backbone.py               # YOLO26-mini (4-stage C2f, GN-replaced norms)
│   ├── fusion.py                 # depthwise cross-correlation block
│   ├── decoder.py                # FPN-style mask decoder
│   └── masktracknet.py           # full model assembly
│
├── engines/
│   ├── train.py                  # main training loop (single-GPU + grad-accum)
│   ├── eval.py                   # DAVIS J&F + rockets-masks IoU
│   ├── losses.py                 # BCE + Dice + boundary-Dice
│   └── schedulers.py             # cosine + warmup
│
├── scripts/
│   ├── prepare_domain_masks.py   # bbox→rectangle (default) or SAM-assisted mask generation; domain-agnostic, rockets is the first user
│   ├── train_stage1.sh           # VOS pretrain on Grace (mandatory)
│   ├── train_stage2.sh           # domain fine-tune on Grace (optional; takes a domain root as arg)
│   └── run_pipeline.sh           # tmux orchestrator (mirrors V3 detector pipeline)
│
├── checkpoints/                  # gitignored; output dir
├── docs/
│   └── README.md                 # quickstart for training + eval on Grace
└── goal.md                       # existing
```

## 8. Implementation order (informational; full plan in writing-plans output)

**Mandatory path (produces the shippable cv-v2 model):**

1. Rewrite `data/dataset.py` to the new schema; add `augmentations.py`, `samplers.py`. Verify by visualising 50 sample pairs.
2. Implement `models/backbone.py` (YOLO26-mini) + param-count test.
3. Implement `models/fusion.py` and `models/decoder.py` + shape test on a single dummy pair.
4. Implement `models/masktracknet.py` + end-to-end forward shape test + FLOP count via `fvcore`.
5. Implement `engines/losses.py` + unit tests on toy masks.
6. Implement `engines/train.py` with a smoke test (1 epoch on DAVIS only, batch 2, 384×384) before scheduling Stage 1 on Grace.
7. Implement `engines/eval.py` with J&F on DAVIS val.
8. Run Stage 1 on Grace. Acceptance: DAVIS J&F ≥ 0.65. **At this point cv-v2 is shippable.**
9. Final FLOP/param/eval report.

**Optional path (per-domain fine-tune; gated on having that domain's data):**

10. Build `scripts/prepare_domain_masks.py` and generate domain mask data (rockets first, but the script is domain-agnostic).
11. Run Stage 2 on Grace for the chosen domain. Acceptance: domain val mIoU ≥ 0.70.
12. Add domain-specific eval report.

## 9. Decisions log (for traceability)

| Decision | Rationale | Date |
|---|---|---|
| Mask-only output (no bbox/presence head) | Matches DAVIS/YT-VOS protocol; bbox derivable from mask post-hoc | 2026-04-27 |
| Pairwise training; Mode A + Mode B inference | Same weights, cheaper than memory-network; honors `goal.md` "pure CNN" | 2026-04-27 |
| Train from scratch | User decision — clean provenance, sufficient YT-VOS data to avoid wasted compute | 2026-04-27 |
| Option A architecture (Siamese + DW correlation + FPN) | Best fit for ~10M params, ≥4 conv layers, pure CNN, class-agnostic | 2026-04-27 |
| 512 → 960 multi-scale schedule | Stage 1 fast convergence on VOS; Stage 2 matches V3 detector resolution | 2026-04-27 |
| GroupNorm everywhere (no BN) | Resolution-agnostic deployment; stable at small batch | 2026-04-27 |
| AdamW (not SGD) | Standard for from-scratch CNN segmentation; converges faster than SGD on this task family | 2026-04-27 |
| Single-GPU + grad-accum (no DDP) | V3 documented regime-switch regression; consistency over throughput | 2026-04-27 |
| Defer inference target | User decision — focus this spec on training | 2026-04-27 |
| 10M target / 20M upper bound treated as guideline, not hard cap | User clarification — `goal.md` numbers are suggested sizes, not enforced limits | 2026-04-27 |
| SAM only relevant for rockets (not VOS data) | DAVIS and YT-VOS already ship pixel-perfect masks; SAM was incorrectly framed as labelling for all stages in the first draft | 2026-04-27 |
| Stage 2 (domain fine-tune) is fully optional, not just conditional | cv-v2 is "track anything", not "track rockets". Stage 1 is the deliverable; rocket fine-tune is one of many possible domain-adaptation experiments and is not on the critical path. | 2026-04-27 |
| Rotation augmentation (Stage 1 ±15°, Stage 2 ±20°), independent per ref/tgt | User decision — drone/rocket/animal targets appear at any orientation, and rotating ref+tgt independently forces the model to learn rotation-invariant matching instead of a temporally-correlated prior | 2026-04-27 |

## 10. Risks and open questions

- **R1: rocket mask data labelling cost.** Cheapest path is bbox→rectangle pseudo-masks (zero extra cost). SAM-assisted upgrade is 8–17 GPU-hours upfront on ~30k frames. Pick based on whether Stage-1-only quality is already acceptable on rocket footage.
- **R2: pure CNN may underperform attention-based competitors at the J&F=0.65 target.** Mitigation: if Stage 1 plateaus below target, the first lever is decoder capacity (cheap), then fusion-kernel size (k=5→7), then giving up the "no attention" constraint as a v3.
- **R3: Any domain fine-tune narrows the distribution** (the rocket case is sky background + small targets, but the same applies to any single-domain fine-tune). Risk of catastrophic forgetting on the general-VOS distribution. Mitigation: continue mixing 30% YT-VOS samples into Stage 2 batches if domain val mIoU plateaus, and always keep a Stage-1-only checkpoint available for users who want the generic tracker.
- **R4: Multi-scale training increases dataloader CPU load.** May need to bump `num_workers` from 8 to 16 on Grace, and pre-resize-cache YT-VOS at 640 max-side to speed up I/O.
- **R5: Dataset upload to Grace.** DAVIS (~2.5 GB) and YouTube-VOS 2019 (~20 GB) have not yet been uploaded to Grace. Upload them before Stage 1 kickoff. The download scripts under `src/cv-v2/scripts/` (`download_davis.{ps1,sh}`, `download_youtube_vos.{ps1,sh}`) can be run directly on Grace to fetch DAVIS; YT-VOS requires Kaggle CLI auth or a manually staged zip. Plan a one-time ~30-minute upload/download window into the Stage 1 prep checklist.
- **Decided: eval cadence = every 5 epochs.** DAVIS-2017 val is ~2100 inferences; at a generous 50 ms/inference that's <2 minutes per eval pass, which is negligible against an 80-epoch Stage 1 run.
