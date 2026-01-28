import { z } from "zod";

// ============================================================================
// UTILITY SCHEMAS
// ============================================================================

/** Hex color validation regex */
const colorRegex = /^#(?:[0-9a-fA-F]{3}){1,2}$/;

/** Valid hex color string (e.g., "#FF0000" or "#F00") */
export const colorSchema = z.string().regex(colorRegex, "Invalid hex color");

/** ISO 8601 datetime string */
export const isoDateSchema = z.string().datetime();

// ============================================================================
// LABEL SCHEMAS
// ============================================================================

/**
 * Label (formerly ProjectClass) - defines a labeling category
 * Used in Project.labels as a mapping of labelId -> Label
 */
export const labelSchema = z.object({
  /** Unique identifier for the label within the project */
  labelId: z.string().min(1),
  /** Human-readable name for the label */
  name: z.string().min(1),
  /** Display color for this label (hex) */
  color: colorSchema,
});

/**
 * Labels map: labelId -> Label
 * This is the format stored in Project
 */
export const labelsMapSchema = z.record(z.string(), labelSchema);

// ============================================================================
// MASK SCHEMAS (Collection 2)
// ============================================================================

/**
 * Individual Mask entity
 * Represents a single segmentation mask for one object/region
 *
 * Structure:
 * - maskId: unique identifier
 * - labelId: which label/class this mask belongs to (can be null if unlabeled)
 * - color: display color (derived from label, or transparent if unlabeled)
 * - binaryMask: serialized sparse representation of 1s and 0s
 * - size: total pixel count (sum of binary mask)
 */
export const maskSchema = z.object({
  /** Unique identifier for this mask */
  maskId: z.string().min(1),
  /** Label ID this mask is assigned to (null if unlabeled) */
  labelId: z.string().nullable(),
  /** Display color (from label, or transparent hex if unlabeled) */
  color: colorSchema.nullable(),
  /** Storage path for the binary mask file in Cloud Storage */
  storagePath: z.string().min(1),
  /** Total pixel count in this mask */
  size: z.number().int().nonnegative(),
  /** Mask dimensions */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

/**
 * Mask labels mapping: maskId -> labelId (or null if unlabeled)
 */
export const maskLabelsMapSchema = z.record(z.string(), z.string().nullable());

/**
 * MaskMap entity
 * Links an image to all its masks and provides quick lookup structures
 *
 * Structure:
 * - maskMapId: unique identifier
 * - imageId: the image this map belongs to
 * - maskLabels: dictionary of maskId -> labelId (source of truth for labels)
 * - colorMap: 2D sparse map of pixel -> blended color (for preview rendering)
 * - maskIds: list of all mask IDs belonging to this image
 */
export const maskMapSchema = z.object({
  /** Unique identifier for this mask map */
  maskMapId: z.string().min(1),
  /** Image ID this mask map belongs to */
  imageId: z.string().min(1),
  /**
   * Dictionary of maskId -> labelId
   * Format: { "mask_001": "label_001", "mask_002": null }
   * This is the source of truth for mask labeling
   * null means the mask is unlabeled
   */
  maskLabels: maskLabelsMapSchema,
  /**
   * Storage path for the colorMap JSON file in Cloud Storage
   * ColorMap format: { "rowIndex": { "colIndex": "#RRGGBB" } }
   */
  colorMapStoragePath: z.string().min(1),
  /** List of all mask IDs in this image */
  maskIds: z.array(z.string().min(1)),
  /** Dimensions matching the image */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

// ============================================================================
// PROJECT SCHEMAS (Collection 1)
// ============================================================================

/**
 * Project creation request
 */
export const projectCreateSchema = z.object({
  /** Project name */
  name: z.string().min(1),
  /** Optional project description */
  description: z.string().nullable().optional(),
  /**
   * Labels configuration: labelId -> Label
   * At least one label is required
   */
  labels: z.record(z.string(), labelSchema).refine(
    (labels) => Object.keys(labels).length >= 1,
    { message: "At least one label is required" }
  ),
});

/**
 * Project update request (all fields optional)
 */
export const projectUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  labels: z.record(z.string(), labelSchema).optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: "At least one field must be provided" }
);

/**
 * Full project record (as stored in Firestore)
 */
export const projectRecordSchema = z.object({
  /** Unique project identifier */
  projectId: z.string().min(1),
  /** Project name */
  name: z.string().min(1),
  /** Project description */
  description: z.string().nullable(),
  /** Labels configuration */
  labels: z.record(z.string(), labelSchema),
  /** List of image IDs in this project */
  imageIds: z.array(z.string().min(1)),
  /** Owner user ID */
  ownerUid: z.string().min(1),
  /** Timestamps */
  createdAt: z.any(), // Firestore Timestamp
  updatedAt: z.any(), // Firestore Timestamp
});

// ============================================================================
// IMAGE SCHEMAS (Collection 1)
// ============================================================================

/** Image labeling status */
export const imageStatusSchema = z.enum(["unlabeled", "in_progress", "labeled"]);

/**
 * Image metadata
 */
export const imageMetaSchema = z.object({
  /** Original filename */
  fileName: z.string().min(1),
  /** Image dimensions */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Labeling status */
  status: imageStatusSchema,
  /** Optional tags for organization */
  tags: z.array(z.string()).optional(),
});

/**
 * Lock information embedded in image record
 */
export const imageLockSchema = z.object({
  /** User ID who holds the lock */
  lockedBy: z.string().min(1),
  /** When the lock expires */
  expiresAt: z.any(), // Firestore Timestamp or ISO string
});

/**
 * Full image record (as stored in Firestore)
 */
export const imageRecordSchema = z.object({
  /** Unique image identifier */
  imageId: z.string().min(1),
  /** Project this image belongs to */
  projectId: z.string().min(1),
  /** Reference to the MaskMap for this image (null if no masks) */
  maskMapId: z.string().nullable(),
  /** Whether all masks have been labeled */
  labelComplete: z.boolean(),
  /** Whether the labels have been reviewed/verified */
  reviewed: z.boolean(),
  /** Current lock state (null if not locked) */
  lock: imageLockSchema.nullable(),
  /** Image metadata */
  meta: imageMetaSchema,
  /** Optional video ID if this image is from a video */
  videoId: z.string().nullable().optional(),
  /** User ID of the labeler (null if not assigned) */
  labellerId: z.string().nullable().optional(),
  /** Storage path for the image file */
  storagePath: z.string().optional(),
  /** File content type */
  contentType: z.string().optional(),
  /** File size in bytes */
  sizeBytes: z.number().int().nonnegative().optional(),
  /** Timestamps */
  createdAt: z.any(), // Firestore Timestamp
  updatedAt: z.any(), // Firestore Timestamp
});

/**
 * Image update request
 */
export const imageUpdateSchema = z.object({
  /** Update mask map reference */
  maskMapId: z.string().nullable().optional(),
  /** Update label complete status */
  labelComplete: z.boolean().optional(),
  /** Update reviewed status */
  reviewed: z.boolean().optional(),
  /** Update video ID */
  videoId: z.string().nullable().optional(),
  /** Update labeller ID */
  labellerId: z.string().nullable().optional(),
  /** Partial metadata update */
  meta: imageMetaSchema.partial().optional(),
}).refine(
  (data) => {
    const hasUpdate =
      data.maskMapId !== undefined ||
      data.labelComplete !== undefined ||
      data.reviewed !== undefined ||
      data.videoId !== undefined ||
      data.labellerId !== undefined ||
      data.meta !== undefined;
    return hasUpdate;
  },
  { message: "At least one field must be provided" }
);

// ============================================================================
// LOCK SCHEMAS
// ============================================================================

/**
 * Lock acquire request
 * Frontend should call this every 12 seconds with 15-second duration
 */
export const lockAcquireSchema = z.object({
  /** Image IDs to lock */
  imageIds: z.array(z.string().min(1)).min(1),
  /** User ID requesting the lock */
  userId: z.string().min(1),
  /** Lock duration in milliseconds (default: 15000 = 15 seconds) */
  durationMs: z.number().int().positive().optional().default(15000),
});

/**
 * Lock release request
 */
export const lockReleaseSchema = z.object({
  /** Image IDs to release */
  imageIds: z.array(z.string().min(1)).min(1),
  /** User ID releasing the lock */
  userId: z.string().min(1),
});

/**
 * Lock operation result for a single image
 */
export const lockResultSchema = z.object({
  /** Image ID */
  imageId: z.string().min(1),
  /** Whether lock was acquired/released */
  locked: z.boolean().optional(),
  released: z.boolean().optional(),
  /** Current lock holder (if locked by someone else) */
  lockedBy: z.string().nullable().optional(),
  /** When the lock expires */
  expiresAt: z.string().nullable().optional(),
  /** Error code if operation failed */
  error: z.string().optional(),
});

// ============================================================================
// MASK API SCHEMAS
// ============================================================================

/**
 * Request to create a new mask for an image
 */
export const maskCreateSchema = z.object({
  /** Image ID to add the mask to */
  imageId: z.string().min(1),
  /** Optional label ID (null = unlabeled mask) */
  labelId: z.string().nullable().optional(),
  /**
   * Sparse binary mask data
   * Format: { "rowIndex": { "colIndex": 1 } }
   */
  binaryMask: z.record(z.string(), z.record(z.string(), z.literal(1))),
  /** Mask dimensions */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

/**
 * Request to update a mask's label
 */
export const maskUpdateSchema = z.object({
  /** New label ID (null = unlabeled) */
  labelId: z.string().nullable(),
});

/**
 * Request to update multiple masks at once (batch labeling)
 */
export const maskBatchUpdateSchema = z.object({
  /** Array of mask updates */
  updates: z.array(z.object({
    maskId: z.string().min(1),
    labelId: z.string().nullable(),
  })).min(1),
});

// ============================================================================
// ZIP UPLOAD SCHEMAS
// ============================================================================

/**
 * Metadata for ZIP upload
 */
export const zipUploadMetaSchema = z.object({
  /** Initial status for all images */
  status: imageStatusSchema.optional().default("unlabeled"),
  /** Initial tags for all images */
  tags: z.array(z.string()).optional(),
});

// ============================================================================
// RESPONSE SCHEMAS
// ============================================================================

/**
 * Project list response
 */
export const projectListResponseSchema = z.object({
  items: z.array(z.object({
    projectId: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    imageCount: z.number().int().nonnegative().optional(),
    labeledCount: z.number().int().nonnegative().optional(),
    unlabeledCount: z.number().int().nonnegative().optional(),
  })),
});

/**
 * Image list response
 */
export const imageListResponseSchema = z.object({
  items: z.array(imageRecordSchema.partial()),
  cursor: z.string().nullable().optional(),
  total: z.number().int().nonnegative().optional(),
});

/**
 * Lock operation response
 */
export const lockResponseSchema = z.object({
  results: z.array(lockResultSchema),
});

/**
 * ZIP upload response
 */
export const zipUploadResponseSchema = z.object({
  imageIds: z.array(z.string()),
  count: z.number().int().nonnegative(),
  masksCount: z.number().int().nonnegative(),
});

