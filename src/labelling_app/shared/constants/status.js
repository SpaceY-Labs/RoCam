"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MASK_SOURCE = exports.EXPORT_STATUS = exports.IMAGE_STATUS = void 0;
/**
 * Image workflow statuses
 */
exports.IMAGE_STATUS = {
    UNLABELED: 'unlabeled',
    ASSIGNED: 'assigned',
    IN_PROGRESS: 'in_progress',
    LABELED: 'labeled',
};
/**
 * Export job statuses
 */
exports.EXPORT_STATUS = {
    QUEUED: 'queued',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed',
};
/**
 * Mask source types
 */
exports.MASK_SOURCE = {
    SAM3_AUTO: 'sam3_auto',
    SAM3_CLICK: 'sam3_click',
    SAM3_SEMANTIC: 'sam3_semantic',
    MANUAL: 'manual',
};
