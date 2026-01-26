// ============================================================================
// LABEL TYPES
// ============================================================================

/**
 * Label (formerly ProjectClass) - defines a labeling category
 */
export type Label = {
  /** Unique identifier for the label within the project */
  labelId: string;
  /** Human-readable name for the label */
  name: string;
  /** Display color for this label (hex, e.g., "#FF0000") */
  color: string;
};

/**
 * Labels map: labelId -> Label
 */
export type LabelsMap = Record<string, Label>;

// ============================================================================
// MASK TYPES (Collection 2)
// ============================================================================

/**
 * Sparse binary mask representation
 * Format: { "rowIndex": { "colIndex": 1 } }
 * Only stores pixels that are part of the mask
 */
export type SparseBinaryMask = Record<string, Record<string, 1>>;

/**
 * Individual Mask entity
 * Represents a single segmentation mask for one object/region
 * Note: Binary mask data is stored in Cloud Storage (too large for Firestore)
 */
export type Mask = {
  /** Unique identifier for this mask */
  maskId: string;
  /** Label ID this mask is assigned to (null if unlabeled) */
  labelId: string | null;
  /** Display color (from label, or null if unlabeled = transparent) */
  color: string | null;
  /** Storage path for the binary mask file in Cloud Storage */
  storagePath: string;
  /** Total pixel count in this mask */
  size: number;
  /** Mask dimensions */
  width: number;
  height: number;
};

/**
 * Sparse color map representation
 * Format: { "rowIndex": { "colIndex": "#RRGGBB" } }
 */
export type SparseColorMap = Record<string, Record<string, string>>;

/**
 * Mask labels mapping: maskId -> labelId
 * Stored on MaskMap to enable efficient colorMap computation
 */
export type MaskLabelsMap = Record<string, string | null>;

/**
 * MaskMap entity
 * Links an image to all its masks and provides quick lookup structures
 * Note: colorMap is stored in Cloud Storage (too large for Firestore)
 */
export type MaskMap = {
  /** Unique identifier for this mask map */
  maskMapId: string;
  /** Image ID this mask map belongs to */
  imageId: string;
  /**
   * Dictionary of maskId -> labelId
   * This is the source of truth for mask labeling (per design doc)
   * Used to compute colorMap
   */
  maskLabels: MaskLabelsMap;
  /**
   * Storage path for the colorMap JSON file in Cloud Storage
   * ColorMap format: { "rowIndex": { "colIndex": "#RRGGBB" } }
   */
  colorMapStoragePath: string;
  /** List of all mask IDs in this image */
  maskIds: string[];
  /** Dimensions matching the image */
  width: number;
  height: number;
};

// ============================================================================
// PROJECT TYPES (Collection 1)
// ============================================================================

/**
 * Project entity
 */
export type Project = {
  /** Unique project identifier */
  projectId: string;
  /** Project name */
  name: string;
  /** Project description */
  description: string | null;
  /** Labels configuration: labelId -> Label */
  labels: LabelsMap;
  /** List of image IDs in this project */
  imageIds: string[];
  /** Owner user ID */
  ownerUid: string;
};

/**
 * Project creation request
 */
export type ProjectCreateRequest = {
  name: string;
  description?: string | null;
  labels: LabelsMap;
};

/**
 * Project update request
 */
export type ProjectUpdateRequest = {
  name?: string;
  description?: string | null;
  labels?: LabelsMap;
};

// ============================================================================
// IMAGE TYPES (Collection 1)
// ============================================================================

/** Image labeling status */
export type ImageStatus = "unlabeled" | "in_progress" | "labeled";

/**
 * Image metadata
 */
export type ImageMeta = {
  /** Original filename */
  fileName: string;
  /** Image dimensions */
  width: number;
  height: number;
  /** Labeling status */
  status: ImageStatus;
  /** Optional tags for organization */
  tags?: string[];
};

/**
 * Lock information embedded in image record
 */
export type ImageLock = {
  /** User ID who holds the lock */
  lockedBy: string;
  /** When the lock expires (ISO string or Firestore Timestamp) */
  expiresAt: string | unknown;
};

/**
 * Full image record
 */
export type ImageRecord = {
  /** Unique image identifier */
  imageId: string;
  /** Project this image belongs to */
  projectId: string;
  /** Reference to the MaskMap for this image (null if no masks) */
  maskMapId: string | null;
  /** Whether all masks have been labeled */
  labelComplete: boolean;
  /** Whether the labels have been reviewed/verified */
  reviewed: boolean;
  /** Current lock state (null if not locked) */
  lock: ImageLock | null;
  /** Image metadata */
  meta: ImageMeta;
  /** Optional video ID if this image is from a video */
  videoId?: string | null;
  /** User ID of the labeler (null if not assigned) */
  labellerId?: string | null;
  /** Storage path for the image file */
  storagePath?: string;
  /** File content type */
  contentType?: string;
  /** File size in bytes */
  sizeBytes?: number;
};

/**
 * Image update request
 */
export type ImageUpdateRequest = {
  maskMapId?: string | null;
  labelComplete?: boolean;
  reviewed?: boolean;
  videoId?: string | null;
  labellerId?: string | null;
  meta?: Partial<ImageMeta>;
};

// ============================================================================
// LOCK TYPES
// ============================================================================

/**
 * Lock acquire request
 * Frontend should call this every 12 seconds with 15-second duration
 */
export type LockAcquireRequest = {
  /** Image IDs to lock */
  imageIds: string[];
  /** User ID requesting the lock */
  userId: string;
  /** Lock duration in milliseconds (default: 15000 = 15 seconds) */
  durationMs?: number;
};

/**
 * Lock release request
 */
export type LockReleaseRequest = {
  /** Image IDs to release */
  imageIds: string[];
  /** User ID releasing the lock */
  userId: string;
};

/**
 * Lock operation result for a single image
 */
export type LockResult = {
  /** Image ID */
  imageId: string;
  /** Whether lock was acquired */
  locked?: boolean;
  /** Whether lock was released */
  released?: boolean;
  /** Current lock holder (if locked by someone else) */
  lockedBy?: string | null;
  /** When the lock expires (ISO string) */
  expiresAt?: string | null;
  /** Error code if operation failed */
  error?: string;
};

// ============================================================================
// MASK API TYPES
// ============================================================================

/**
 * Request to create a new mask for an image
 */
export type MaskCreateRequest = {
  /** Image ID to add the mask to */
  imageId: string;
  /** Optional label ID (null = unlabeled mask) */
  labelId?: string | null;
  /** Sparse binary mask data */
  binaryMask: SparseBinaryMask;
  /** Mask dimensions */
  width: number;
  height: number;
};

/**
 * Request to update a mask's label
 */
export type MaskUpdateRequest = {
  /** New label ID (null = unlabeled) */
  labelId: string | null;
};

/**
 * Request to update multiple masks at once (batch labeling)
 */
export type MaskBatchUpdateRequest = {
  /** Array of mask updates */
  updates: Array<{
    maskId: string;
    labelId: string | null;
  }>;
};

// ============================================================================
// ZIP UPLOAD TYPES
// ============================================================================

/**
 * Metadata for ZIP upload
 */
export type ZipUploadMeta = {
  /** Initial status for all images */
  status?: ImageStatus;
  /** Initial tags for all images */
  tags?: string[];
};

// ============================================================================
// RESPONSE TYPES
// ============================================================================

/**
 * Project list item
 */
export type ProjectListItem = {
  projectId: string;
  name: string;
  description: string | null;
  imageCount?: number;
  labeledCount?: number;
  unlabeledCount?: number;
};

/**
 * Project list response
 */
export type ProjectListResponse = {
  items: ProjectListItem[];
};

/**
 * Image list response
 */
export type ImageListResponse = {
  items: Partial<ImageRecord>[];
  cursor?: string | null;
  total?: number;
};

/**
 * Lock operation response
 */
export type LockResponse = {
  results: LockResult[];
};

/**
 * ZIP upload response
 */
export type ZipUploadResponse = {
  imageIds: string[];
  count: number;
  masksCount: number;
};

