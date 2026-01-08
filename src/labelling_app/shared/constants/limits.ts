/**
 * Image upload limits
 */
export const IMAGE_LIMITS = {
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
export const LOCK_CONFIG = {
  THRESHOLD: 10, // Images below this are unlocked
  DURATION_MS: 24 * 60 * 60 * 1000, // 24 hours
};

/**
 * Export configuration
 */
export const EXPORT_CONFIG = {
  BATCH_SIZE: 500,
  DOWNLOAD_EXPIRY_MS: 24 * 60 * 60 * 1000, // 24 hours
  MAX_CONCURRENT_EXPORTS: 3,
};

/**
 * Pagination defaults
 */
export const PAGINATION = {
  DEFAULT_LIMIT: 50,
  MAX_LIMIT: 500,
};

/**
 * Default organization ID
 */
export const DEFAULT_ORG_ID = 'rocam';
