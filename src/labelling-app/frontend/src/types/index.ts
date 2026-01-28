// ============================================================================
// LABEL TYPES
// ============================================================================

/**
 * Label - defines a labeling category for masks
 */
export interface Label {
  /** Unique identifier for the label within the project */
  labelId: string;
  /** Human-readable name for the label */
  name: string;
  /** Display color for this label (hex, e.g., "#FF0000") */
  color: string;
}

/**
 * Labels map: labelId -> Label
 */
export type LabelsMap = Record<string, Label>;

// ============================================================================
// MASK TYPES
// ============================================================================

/**
 * Sparse binary mask representation
 * Format: { "rowIndex": { "colIndex": 1 } }
 */
export type SparseBinaryMask = Record<string, Record<string, 1>>;

/**
 * Individual Mask entity
 * Note: Binary mask data is stored in Cloud Storage (too large to inline)
 */
export interface Mask {
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
}

/**
 * Sparse label map: pixel position -> array of label IDs
 * Format: { "rowIndex": { "colIndex": ["labelId1", "labelId2"] } }
 */
export type SparseLabelMap = Record<string, Record<string, string[]>>;

/**
 * Sparse color map: pixel position -> blended color
 * Format: { "rowIndex": { "colIndex": "#RRGGBB" } }
 */
export type SparseColorMap = Record<string, Record<string, string>>;

/**
 * Mask labels mapping: maskId -> labelId (or null if unlabeled)
 */
export type MaskLabelsMap = Record<string, string | null>;

/**
 * MaskOverlay: 2D array where each pixel stores the INDEX of the smallest
 * mask covering that pixel, or -1 if no mask covers it.
 *
 * Uses indices instead of full UUIDs to reduce payload size significantly.
 * The maskIds array maps index -> maskId.
 */
export interface MaskOverlay {
  width: number;
  height: number;
  /** Array of maskIds - index in this array corresponds to index in data */
  maskIds: string[];
  /** Flattened row-major array: data[row * width + col] = maskIndex or -1 for no mask */
  data: number[];
}

/**
 * MaskMap entity - links an image to all its masks
 * Note: colorMap and maskOverlay are stored in Cloud Storage (too large)
 */
export interface MaskMap {
  /** Unique identifier for this mask map */
  maskMapId: string;
  /** Image ID this mask map belongs to */
  imageId: string;
  /** Dictionary of maskId -> labelId (source of truth for labels) */
  maskLabels: MaskLabelsMap;
  /** Storage path for the colorMap JSON file in Cloud Storage */
  colorMapStoragePath: string;
  /** Storage path for the maskOverlay JSON file in Cloud Storage */
  maskOverlayStoragePath: string;
  /** Dictionary of maskId -> pixel count (for size info) */
  maskSizes: Record<string, number>;
  /** List of all mask IDs in this image */
  maskIds: string[];
  /** Dimensions matching the image */
  width: number;
  height: number;
}

// ============================================================================
// PROJECT TYPES
// ============================================================================

/**
 * Project entity
 */
export interface Project {
  /** Unique project identifier */
  projectId: string;
  /** Project name */
  name: string;
  /** Project description */
  description: string | null;
  /** Labels configuration: labelId -> Label */
  labels: LabelsMap;
  /** List of image IDs in this project (optional in list views) */
  imageIds?: string[];
  /** Timestamps */
  createdAt?: string;
  /** Computed counts (from API) */
  imageCount?: number;
  labeledCount?: number;
  unlabeledCount?: number;
}

/**
 * Form data for creating/editing a project
 */
export interface ProjectFormData {
  name: string;
  description: string;
  labels: LabelsMap;
}

// ============================================================================
// IMAGE TYPES
// ============================================================================

/** Image labeling status */
export type ImageStatus = 'unlabeled' | 'in_progress' | 'labeled';

/**
 * Image metadata
 */
export interface ImageMeta {
  /** Original filename */
  fileName: string;
  /** Image dimensions */
  width: number;
  height: number;
  /** Labeling status */
  status: ImageStatus;
  /** Optional tags for organization */
  tags?: string[];
}

/**
 * Lock information
 */
export interface ImageLock {
  /** User ID who holds the lock */
  lockedBy: string;
  /** When the lock expires (ISO string) */
  expiresAt: string;
}

/**
 * Project image entity
 */
export interface ProjectImage {
  /** Unique image identifier */
  imageId: string;
  /** Project this image belongs to */
  projectId: string;
  /** Reference to the MaskMap for this image (null if no masks) */
  maskMapId?: string | null;
  /** Whether all masks have been labeled */
  labelComplete?: boolean;
  /** Whether the labels have been reviewed/verified */
  reviewed?: boolean;
  /** Current lock state (null if not locked) */
  lock?: ImageLock | null;
  /** Image metadata */
  meta: ImageMeta;
  /** Signed URL for image file */
  fileUrl?: string;
  /** Signed URL for preview/thumbnail */
  thumbnailUrl?: string;
  /** Creation timestamp */
  createdAt?: string;
}

// ============================================================================
// LOCK TYPES
// ============================================================================

/**
 * Lock operation result for a single image
 */
export interface LockResult {
  imageId: string;
  locked?: boolean;
  released?: boolean;
  lockedBy?: string | null;
  expiresAt?: string | null;
  error?: string;
}

/**
 * Lock operation response
 */
export interface LockResponse {
  results: LockResult[];
}

// ============================================================================
// UI STATE TYPES
// ============================================================================

export type RouteId = 'projects' | 'create' | 'label' | 'upload' | 'preview';

export interface NavItem {
  id: RouteId;
  label: string;
  description: string;
  icon: string;
}

export interface PageMeta {
  eyebrow: string;
  title: string;
  subtitle: string;
}

// ============================================================================
// FORM TYPES
// ============================================================================

export interface UploadFormData {
  file: File | null;
  status: ImageStatus;
  tags: string[];
}

// ============================================================================
// COMPONENT PROP TYPES
// ============================================================================

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'small' | 'medium' | 'large';
  loading?: boolean;
}

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
}

export interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

/**
 * Project list item from API
 */
export interface ProjectApiItem {
  projectId: string;
  name: string;
  description?: string | null;
  labels?: LabelsMap;
  createdAt?: string;
  imageCount?: number;
  labeledCount?: number;
  unlabeledCount?: number;
}

/**
 * Projects list API response
 */
export interface ProjectsApiResponse {
  items: ProjectApiItem[];
}

/**
 * Image metadata from API
 */
export interface ProjectImageMetaApi {
  fileName?: string;
  width?: number;
  height?: number;
  status?: ImageStatus;
  tags?: string[];
}

/**
 * Image item from API
 */
export interface ProjectImageApiItem {
  imageId: string;
  projectId?: string;
  maskMapId?: string | null;
  labelComplete?: boolean;
  reviewed?: boolean;
  lock?: ImageLock | null;
  meta?: ProjectImageMetaApi;
  fileUrl?: string;
  createdAt?: string;
}

/**
 * Images list API response
 */
export interface ProjectImagesApiResponse {
  items: ProjectImageApiItem[];
  cursor?: string | null;
  total?: number;
}

/**
 * ZIP upload API response
 */
export interface UploadZipResponse {
  imageIds: string[];
  count: number;
  masksCount: number;
}

// ============================================================================
// MASK API TYPES
// ============================================================================

/**
 * Request to update a mask's label
 */
export interface MaskUpdateRequest {
  labelId: string | null;
}

/**
 * Request to update multiple masks at once
 */
export interface MaskBatchUpdateRequest {
  updates: Array<{
    maskId: string;
    labelId: string | null;
  }>;
}

/**
 * Mask from API
 */
export interface MaskApiItem {
  maskId: string;
  labelId: string | null;
  color: string | null;
  storagePath: string;
  size: number;
  width: number;
  height: number;
}

/**
 * MaskMap from API
 */
export interface MaskMapApiItem {
  maskMapId: string;
  imageId: string;
  maskLabels: MaskLabelsMap;
  colorMapStoragePath: string;
  maskIds: string[];
  width: number;
  height: number;
}
