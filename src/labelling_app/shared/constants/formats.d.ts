/**
 * Supported export formats
 */
export declare const EXPORT_FORMATS: readonly ["coco_json", "raw_masks", "yolo", "pascal_voc"];
/**
 * Export format display names
 */
export declare const EXPORT_FORMAT_LABELS: Record<string, string>;
/**
 * SAM3 segmentation modes
 */
export declare const SAM3_MODES: {
    readonly AUTO: "auto";
    readonly CLICK: "click";
    readonly SEMANTIC: "semantic";
};
/**
 * Default SAM3 mode
 */
export declare const DEFAULT_SAM3_MODE = "click";
//# sourceMappingURL=formats.d.ts.map