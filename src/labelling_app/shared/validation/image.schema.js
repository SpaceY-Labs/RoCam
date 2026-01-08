"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bulkDeleteSchema = exports.imageListQuerySchema = exports.confirmUploadSchema = exports.getUploadUrlsSchema = void 0;
const zod_1 = require("zod");
const limits_1 = require("../constants/limits");
/**
 * Schema for requesting upload URLs
 */
exports.getUploadUrlsSchema = zod_1.z.object({
    files: zod_1.z
        .array(zod_1.z.object({
        fileName: zod_1.z.string().min(1).max(255),
        contentType: zod_1.z.enum(limits_1.IMAGE_LIMITS.ALLOWED_MIME_TYPES),
        size: zod_1.z.number().max(limits_1.IMAGE_LIMITS.MAX_FILE_SIZE),
    }))
        .min(1)
        .max(limits_1.IMAGE_LIMITS.MAX_BATCH_UPLOAD),
});
/**
 * Schema for confirming uploads
 */
exports.confirmUploadSchema = zod_1.z.object({
    imageIds: zod_1.z.array(zod_1.z.string()).min(1),
});
/**
 * Schema for image list query params
 */
exports.imageListQuerySchema = zod_1.z.object({
    status: zod_1.z.enum(['unlabeled', 'assigned', 'in_progress', 'labeled']).optional(),
    assignedTo: zod_1.z.string().optional(),
    cursor: zod_1.z.string().optional(),
    limit: zod_1.z.number().min(1).max(500).optional(),
    orderBy: zod_1.z.enum(['uploadedAt', 'assignedAt', 'status']).optional(),
    orderDirection: zod_1.z.enum(['asc', 'desc']).optional(),
});
/**
 * Schema for bulk delete
 */
exports.bulkDeleteSchema = zod_1.z.object({
    imageIds: zod_1.z.array(zod_1.z.string()).min(1).max(100),
});
