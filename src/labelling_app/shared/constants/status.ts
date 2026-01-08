/**
 * Image workflow statuses
 */
export const IMAGE_STATUS = {
  UNLABELED: 'unlabeled',
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'in_progress',
  LABELED: 'labeled',
} as const;

/**
 * Export job statuses
 */
export const EXPORT_STATUS = {
  QUEUED: 'queued',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

/**
 * Mask source types
 */
export const MASK_SOURCE = {
  SAM3_AUTO: 'sam3_auto',
  SAM3_CLICK: 'sam3_click',
  SAM3_SEMANTIC: 'sam3_semantic',
  MANUAL: 'manual',
} as const;
