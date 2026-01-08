"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_ORG_ID = exports.PAGINATION = exports.EXPORT_CONFIG = exports.LOCK_CONFIG = exports.IMAGE_LIMITS = void 0;
/**
 * Image upload limits
 */
exports.IMAGE_LIMITS = {
    MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB
    ALLOWED_FORMATS: ['jpg', 'jpeg', 'png', 'webp', 'bmp'],
    ALLOWED_MIME_TYPES: [
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/bmp',
    ],
    MAX_BATCH_UPLOAD: 500,
    THUMBNAIL_SIZE: 256,
    THUMBNAIL_FORMAT: 'webp',
    THUMBNAIL_QUALITY: 80,
};
/**
 * Assignment lock configuration
 */
exports.LOCK_CONFIG = {
    THRESHOLD: 10, // Images below this are unlocked
    DURATION_MS: 24 * 60 * 60 * 1000, // 24 hours
};
/**
 * Export configuration
 */
exports.EXPORT_CONFIG = {
    BATCH_SIZE: 500,
    DOWNLOAD_EXPIRY_MS: 24 * 60 * 60 * 1000, // 24 hours
    MAX_CONCURRENT_EXPORTS: 3,
};
/**
 * Pagination defaults
 */
exports.PAGINATION = {
    DEFAULT_LIMIT: 50,
    MAX_LIMIT: 500,
};
/**
 * Default organization ID
 */
exports.DEFAULT_ORG_ID = 'rocam';
