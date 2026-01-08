import type { Timestamp } from 'firebase/firestore';

/**
 * Standard API response wrapper
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

/**
 * API error structure
 */
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> {
  items: T[];
  cursor: string | null;
  hasMore: boolean;
  total?: number;
}

/**
 * Signed upload URL response
 */
export interface UploadUrlResponse {
  imageId: string;
  uploadUrl: string;
  thumbnailUploadUrl: string;
  expiresAt: Timestamp;
}

/**
 * Bulk upload URLs request
 */
export interface GetUploadUrlsInput {
  files: Array<{
    fileName: string;
    contentType: string;
    size: number;
  }>;
}

/**
 * Confirm upload request
 */
export interface ConfirmUploadInput {
  imageIds: string[];
}
