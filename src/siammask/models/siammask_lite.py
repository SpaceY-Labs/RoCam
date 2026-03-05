"""
SiamMask-Lite: Full Model Assembly

This is the complete model that ties together:
1. LiteBackbone (shared Siamese CNN encoder)
2. MultiScaleCorrelation (visual matching via depthwise cross-correlation)
3. MaskDecoder (mask + bbox + score prediction)

Inference flow:
    Template Phase (once per target):
        reference_image -> backbone -> template_features (cached)

    Tracking Phase (every frame):
        search_crop -> backbone -> search_features
        cross_correlate(template_features, search_features) -> response_maps
        decode(response_maps, search_features) -> mask, bbox, score

The key insight: the template features are computed ONCE and reused every frame.
Only the search branch + correlation + decoder run per frame, saving ~40% compute.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Tuple, Optional, Dict, Any

from .backbone import LiteBackbone, count_parameters
from .correlation import MultiScaleCorrelation
from .mask_head import MaskDecoder


class SiamMaskLite(nn.Module):
    """
    Complete one-shot visual object segmentation model.

    Usage:
        model = SiamMaskLite()

        # Initialize with reference image of target
        template_feats = model.encode_template(reference_crop)  # 127x127 crop

        # For each video frame:
        mask, bbox, score = model.track(search_crop, template_feats)  # 255x255 crop
    """

    # Standard sizes (must match training)
    TEMPLATE_SIZE = 127  # Reference image crop size
    SEARCH_SIZE = 255    # Search region crop size
    MASK_SIZE = 255      # Output mask resolution

    def __init__(self, feat_channels: int = 64, corr_channels: int = 64):
        super().__init__()

        self.backbone = LiteBackbone()
        self.correlation = MultiScaleCorrelation(feat_channels, corr_channels)
        self.decoder = MaskDecoder(corr_channels, feat_channels)

    def encode_template(
        self, template: torch.Tensor
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        Encode reference image into template features. Called ONCE per target.

        Args:
            template: (B, 3, 127, 127) — cropped reference image of target object

        Returns:
            (p2, p3, p4) tuple of template feature maps
        """
        return self.backbone(template)

    def track(
        self,
        search: torch.Tensor,
        template_feats: Tuple[torch.Tensor, torch.Tensor, torch.Tensor],
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        Track target in search region. Called EVERY FRAME.

        Args:
            search: (B, 3, 255, 255) — search region crop from current frame
            template_feats: cached output from encode_template()

        Returns:
            mask:  (B, 1, 255, 255) — mask logits (apply sigmoid for probabilities)
            bbox:  (B, 4) — (cx, cy, w, h) normalized to search region [0, 1]
            score: (B, 1) — target confidence logit
        """
        # Encode search region
        search_feats = self.backbone(search)

        # Cross-correlate template with search at multiple scales
        corr_maps = self.correlation(template_feats, search_feats)

        # Decode to mask, bbox, score
        mask, bbox, score = self.decoder(corr_maps, search_feats, self.MASK_SIZE)

        return mask, bbox, score

    def forward(
        self,
        template: torch.Tensor,
        search: torch.Tensor,
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        Full forward pass (for training). Encodes both template and search.

        Args:
            template: (B, 3, 127, 127)
            search:   (B, 3, 255, 255)

        Returns:
            mask, bbox, score (same as track())
        """
        template_feats = self.encode_template(template)
        return self.track(search, template_feats)

    def get_param_groups(self, base_lr: float) -> list:
        """
        Parameter groups with different learning rates.
        Backbone gets lower LR (features are more general),
        correlation and decoder get full LR.
        """
        return [
            {"params": self.backbone.parameters(), "lr": base_lr * 0.1},
            {"params": self.correlation.parameters(), "lr": base_lr},
            {"params": self.decoder.parameters(), "lr": base_lr},
        ]


class SiamMaskLoss(nn.Module):
    """
    Combined loss for simultaneous mask, bbox, and score prediction.

    Loss = λ_mask * BCE(mask) + λ_bbox * IoU_loss(bbox) + λ_score * BCE(score)
    """

    def __init__(
        self,
        lambda_mask: float = 1.0,
        lambda_bbox: float = 5.0,
        lambda_score: float = 1.0,
    ):
        super().__init__()
        self.lambda_mask = lambda_mask
        self.lambda_bbox = lambda_bbox
        self.lambda_score = lambda_score

    def forward(
        self,
        pred_mask: torch.Tensor,   # (B, 1, H, W) logits
        pred_bbox: torch.Tensor,   # (B, 4) sigmoid'd (cx, cy, w, h)
        pred_score: torch.Tensor,  # (B, 1) logits
        gt_mask: torch.Tensor,     # (B, 1, H, W) binary
        gt_bbox: torch.Tensor,     # (B, 4) (cx, cy, w, h) normalized
        gt_present: torch.Tensor,  # (B, 1) 1.0 if target present, 0.0 if not
    ) -> Dict[str, torch.Tensor]:

        # === Mask loss: pixel-wise BCE with logits ===
        # Only compute mask loss for samples where target is present
        present_mask = gt_present.view(-1) > 0.5
        if present_mask.any():
            mask_loss = F.binary_cross_entropy_with_logits(
                pred_mask[present_mask],
                gt_mask[present_mask],
                reduction="mean",
            )
            # Add dice loss for better mask quality
            pred_prob = torch.sigmoid(pred_mask[present_mask])
            dice_loss = self._dice_loss(pred_prob, gt_mask[present_mask])
            mask_loss = mask_loss + dice_loss
        else:
            mask_loss = torch.tensor(0.0, device=pred_mask.device)

        # === BBox loss: GIoU loss ===
        if present_mask.any():
            bbox_loss = self._giou_loss(
                pred_bbox[present_mask], gt_bbox[present_mask]
            )
        else:
            bbox_loss = torch.tensor(0.0, device=pred_bbox.device)

        # === Score loss: BCE for target presence ===
        score_loss = F.binary_cross_entropy_with_logits(
            pred_score, gt_present, reduction="mean"
        )

        total = (
            self.lambda_mask * mask_loss
            + self.lambda_bbox * bbox_loss
            + self.lambda_score * score_loss
        )

        return {
            "total": total,
            "mask_loss": mask_loss.detach(),
            "bbox_loss": bbox_loss.detach(),
            "score_loss": score_loss.detach(),
            "dice_loss": dice_loss.detach() if present_mask.any() else torch.tensor(0.0),
        }

    @staticmethod
    def _dice_loss(pred: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
        """Soft Dice loss for mask quality."""
        pred = pred.flatten(1)
        target = target.flatten(1)
        intersection = (pred * target).sum(1)
        union = pred.sum(1) + target.sum(1)
        dice = (2.0 * intersection + 1e-6) / (union + 1e-6)
        return (1.0 - dice).mean()

    @staticmethod
    def _giou_loss(pred: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
        """
        Generalized IoU loss for bounding boxes.
        Both inputs: (B, 4) as (cx, cy, w, h) in [0, 1].
        """
        # Convert center format to (x1, y1, x2, y2)
        pred_x1 = pred[:, 0] - pred[:, 2] / 2
        pred_y1 = pred[:, 1] - pred[:, 3] / 2
        pred_x2 = pred[:, 0] + pred[:, 2] / 2
        pred_y2 = pred[:, 1] + pred[:, 3] / 2

        gt_x1 = target[:, 0] - target[:, 2] / 2
        gt_y1 = target[:, 1] - target[:, 3] / 2
        gt_x2 = target[:, 0] + target[:, 2] / 2
        gt_y2 = target[:, 1] + target[:, 3] / 2

        # Intersection
        inter_x1 = torch.max(pred_x1, gt_x1)
        inter_y1 = torch.max(pred_y1, gt_y1)
        inter_x2 = torch.min(pred_x2, gt_x2)
        inter_y2 = torch.min(pred_y2, gt_y2)
        inter_area = (inter_x2 - inter_x1).clamp(0) * (inter_y2 - inter_y1).clamp(0)

        # Union
        pred_area = (pred_x2 - pred_x1) * (pred_y2 - pred_y1)
        gt_area = (gt_x2 - gt_x1) * (gt_y2 - gt_y1)
        union_area = pred_area + gt_area - inter_area + 1e-7

        iou = inter_area / union_area

        # Enclosing box
        enc_x1 = torch.min(pred_x1, gt_x1)
        enc_y1 = torch.min(pred_y1, gt_y1)
        enc_x2 = torch.max(pred_x2, gt_x2)
        enc_y2 = torch.max(pred_y2, gt_y2)
        enc_area = (enc_x2 - enc_x1) * (enc_y2 - enc_y1) + 1e-7

        giou = iou - (enc_area - union_area) / enc_area
        return (1.0 - giou).mean()


def build_model(pretrained: Optional[str] = None) -> SiamMaskLite:
    """Factory function to create and optionally load a pretrained model."""
    model = SiamMaskLite()
    if pretrained:
        state = torch.load(pretrained, map_location="cpu", weights_only=True)
        model.load_state_dict(state["model"] if "model" in state else state)
    return model


if __name__ == "__main__":
    model = SiamMaskLite()
    total = count_parameters(model)
    backbone_p = count_parameters(model.backbone)
    corr_p = count_parameters(model.correlation)
    decoder_p = count_parameters(model.decoder)

    print(f"=== SiamMask-Lite Parameter Count ===")
    print(f"  Backbone:    {backbone_p:>10,} ({100*backbone_p/total:.1f}%)")
    print(f"  Correlation: {corr_p:>10,} ({100*corr_p/total:.1f}%)")
    print(f"  Decoder:     {decoder_p:>10,} ({100*decoder_p/total:.1f}%)")
    print(f"  TOTAL:       {total:>10,}")
    print()

    # Test forward pass
    template = torch.randn(2, 3, 127, 127)
    search = torch.randn(2, 3, 255, 255)
    mask, bbox, score = model(template, search)
    print(f"Mask: {mask.shape}, BBox: {bbox.shape}, Score: {score.shape}")

    # Test loss
    criterion = SiamMaskLoss()
    gt_mask = (torch.rand(2, 1, 255, 255) > 0.5).float()
    gt_bbox = torch.rand(2, 4) * 0.5 + 0.25
    gt_present = torch.ones(2, 1)
    losses = criterion(mask, bbox, score, gt_mask, gt_bbox, gt_present)
    print(f"Losses: { {k: v.item() for k, v in losses.items()} }")
