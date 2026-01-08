/**
 * Supported export formats
 */
export const EXPORT_FORMATS = [
  'coco_json',
  'raw_masks',
  'yolo',
  'pascal_voc',
] as const;

/**
 * Export format display names
 */
export const EXPORT_FORMAT_LABELS: Record<string, string> = {
  coco_json: 'COCO JSON',
  raw_masks: 'Raw Masks (PNG)',
  yolo: 'YOLO',
  pascal_voc: 'Pascal VOC (XML)',
};

/**
 * SAM3 segmentation modes
 */
export const SAM3_MODES = {
  AUTO: 'auto',
  CLICK: 'click',
  SEMANTIC: 'semantic',
} as const;

/**
 * Default SAM3 mode
 */
export const DEFAULT_SAM3_MODE = 'click';
