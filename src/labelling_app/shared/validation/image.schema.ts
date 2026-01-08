import { z } from 'zod';
import { IMAGE_LIMITS } from '../constants/limits.js';

/**
 * Schema for requesting upload URLs
 */
export const getUploadUrlsSchema = z.object({
  files: z
    .array(
      z.object({
        fileName: z.string().min(1).max(255),
        contentType: z.enum(
          IMAGE_LIMITS.ALLOWED_MIME_TYPES as [string, ...string[]]
        ),
        size: z.number().max(IMAGE_LIMITS.MAX_FILE_SIZE),
      })
    )
    .min(1)
    .max(IMAGE_LIMITS.MAX_BATCH_UPLOAD),
});

/**
 * Schema for confirming uploads
 */
export const confirmUploadSchema = z.object({
  imageIds: z.array(z.string()).min(1),
});

/**
 * Schema for image list query params
 */
export const imageListQuerySchema = z.object({
  status: z.enum(['unlabeled', 'assigned', 'in_progress', 'labeled']).optional(),
  assignedTo: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(500).optional(),
  orderBy: z.enum(['uploadedAt', 'assignedAt', 'status']).optional(),
  orderDirection: z.enum(['asc', 'desc']).optional(),
});

/**
 * Schema for bulk delete
 */
export const bulkDeleteSchema = z.object({
  imageIds: z.array(z.string()).min(1).max(100),
});

// Type inference helpers
export type GetUploadUrlsInput = z.infer<typeof getUploadUrlsSchema>;
export type ConfirmUploadInput = z.infer<typeof confirmUploadSchema>;
export type ImageListQuery = z.infer<typeof imageListQuerySchema>;
