import type { Timestamp } from 'firebase/firestore';

/**
 * Image entity representing an uploaded image for labeling
 */
export interface Image {
  id: string;
  fileName: string;
  storagePath: string;
  thumbnailPath: string;
  combinedMaskPath: string | null;
  status: ImageStatus;
  assignedTo: string | null;
  dimensions: ImageDimensions;
  labeledBy: string | null;
  uploadedAt: Timestamp;
  assignedAt: Timestamp | null;
  labeledAt: Timestamp | null;
  lockState: LockState | null;
}

/**
 * Image dimensions
 */
export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Lock state for assignment conflict prevention
 */
export interface LockState {
  locked: boolean;
  lockedAt: Timestamp;
  expiresAt: Timestamp;
}

/**
 * Possible image statuses in workflow
 */
export type ImageStatus = 'unlabeled' | 'assigned' | 'in_progress' | 'labeled';

/**
 * Image list filters
 */
export interface ImageFilters {
  status?: ImageStatus | ImageStatus[];
  assignedTo?: string | null;
  uploadedAfter?: Timestamp;
  uploadedBefore?: Timestamp;
}

/**
 * Paginated image list params
 */
export interface ImageListParams {
  filters?: ImageFilters;
  cursor?: string;
  limit?: number;
  orderBy?: 'uploadedAt' | 'assignedAt' | 'status';
  orderDirection?: 'asc' | 'desc';
}
