"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SAM3_MODE = exports.SAM3_MODES = exports.EXPORT_FORMAT_LABELS = exports.EXPORT_FORMATS = void 0;
/**
 * Supported export formats
 */
exports.EXPORT_FORMATS = [
    'coco_json',
    'raw_masks',
    'yolo',
    'pascal_voc',
];
/**
 * Export format display names
 */
exports.EXPORT_FORMAT_LABELS = {
    coco_json: 'COCO JSON',
    raw_masks: 'Raw Masks (PNG)',
    yolo: 'YOLO',
    pascal_voc: 'Pascal VOC (XML)',
};
/**
 * SAM3 segmentation modes
 */
exports.SAM3_MODES = {
    AUTO: 'auto',
    CLICK: 'click',
    SEMANTIC: 'semantic',
};
/**
 * Default SAM3 mode
 */
exports.DEFAULT_SAM3_MODE = 'click';
