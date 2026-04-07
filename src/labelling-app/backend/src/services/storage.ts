/**
 * Author: Jianqing Liu
 * Date: 2026-01-27
 * Purpose: Firebase Cloud Storage operations for uploading, downloading, and managing files.
 */
import { storage } from "../firebase";
import { config } from "../config";
import { HttpError } from "../middleware/error";
import { colorMapCache, maskBufferCache, maskOverlayCache } from "./cache";

const bucket = storage.bucket();

export const uploadImageBuffer = async (
  storagePath: string,
  buffer: Buffer,
  contentType: string
) => {
  const file = bucket.file(storagePath);
  await file.save(buffer, {
    contentType,
    resumable: false,
    validation: "md5",
  });
  return file;
};

export const deleteFileIfExists = async (storagePath: string) => {
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  if (exists) {
    await file.delete();
  }
  colorMapCache.delete(storagePath);
  maskOverlayCache.delete(storagePath);
  maskBufferCache.delete(storagePath);
};

export const getFileStream = async (storagePath: string) => {
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  if (!exists) {
    throw new HttpError(404, "NOT_FOUND", "File not found");
  }
  return file.createReadStream();
};

export const getFileMetadata = async (storagePath: string) => {
  const file = bucket.file(storagePath);
  const [metadata] = await file.getMetadata();
  return metadata;
};

export const getSignedReadUrl = async (storagePath: string) => {
  if (!config.storageSignedUrlTtlMs) {
    throw new HttpError(500, "INTERNAL_ERROR", "Signed URL TTL not configured");
  }

  const file = bucket.file(storagePath);
  const expires = Date.now() + config.storageSignedUrlTtlMs;
  const [url] = await file.getSignedUrl({
    action: "read",
    expires,
  });
  return url;
};

/**
 * Upload a mask binary file to storage
 */
export const uploadMaskBuffer = async (
  storagePath: string,
  buffer: Buffer
): Promise<void> => {
  const file = bucket.file(storagePath);
  await file.save(buffer, {
    contentType: "application/octet-stream",
    resumable: false,
    validation: "md5",
  });
  maskBufferCache.set(storagePath, buffer);
};

/**
 * Download a mask binary file from storage
 */
export const downloadMaskBuffer = async (storagePath: string): Promise<Buffer> => {
  const cached = maskBufferCache.get(storagePath);
  if (cached) {
    return cached;
  }
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  if (!exists) {
    throw new HttpError(404, "NOT_FOUND", "Mask file not found");
  }
  const [buffer] = await file.download();
  maskBufferCache.set(storagePath, buffer);
  return buffer;
};

/**
 * Build storage path for a mask file
 */
export const buildMaskStoragePath = (
  projectId: string,
  imageId: string,
  maskId: string
): string => {
  return `projects/${projectId}/images/${imageId}/masks/${maskId}.bin`;
};

/**
 * Build storage path for a colorMap file
 */
export const buildColorMapStoragePath = (
  projectId: string,
  maskMapId: string
): string => {
  return `projects/${projectId}/maskmaps/${maskMapId}/colormap.json`;
};

/**
 * Upload colorMap JSON to storage
 */
export const uploadColorMap = async (
  storagePath: string,
  colorMap: Record<string, Record<string, string>>
): Promise<void> => {
  const file = bucket.file(storagePath);
  const jsonData = JSON.stringify(colorMap);
  await file.save(Buffer.from(jsonData, "utf-8"), {
    contentType: "application/json",
    resumable: false,
    validation: "md5",
  });
  colorMapCache.set(storagePath, colorMap);
};

/**
 * Download colorMap JSON from storage
 */
export const downloadColorMap = async (
  storagePath: string
): Promise<Record<string, Record<string, string>>> => {
  const cached = colorMapCache.get(storagePath);
  if (cached) {
    return cached;
  }
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  if (!exists) {
    // Return empty colorMap if file doesn't exist (initial state)
    return {};
  }
  const [buffer] = await file.download();
  const parsed = JSON.parse(buffer.toString("utf-8"));
  colorMapCache.set(storagePath, parsed);
  return parsed;
};

// ============================================================================
// MASK OVERLAY STORAGE
// ============================================================================

/**
 * MaskOverlay structure for storage
 * Uses indices instead of full UUIDs to reduce payload size
 */
interface MaskOverlay {
  width: number;
  height: number;
  /** Array of maskIds - index in this array corresponds to index in data */
  maskIds: string[];
  /** Flattened row-major array: data[row * width + col] = maskIndex or -1 for no mask */
  data: number[];
}

/**
 * Build storage path for a maskOverlay file
 */
export const buildMaskOverlayStoragePath = (
  projectId: string,
  maskMapId: string
): string => {
  return `projects/${projectId}/maskmaps/${maskMapId}/maskoverlay.json`;
};

/**
 * Upload maskOverlay JSON to storage
 */
export const uploadMaskOverlay = async (
  storagePath: string,
  maskOverlay: MaskOverlay
): Promise<void> => {
  console.log(`[storage] uploadMaskOverlay - path: ${storagePath}`);
  console.log(`[storage] MaskOverlay to upload - width: ${maskOverlay.width}, height: ${maskOverlay.height}, maskIds: ${maskOverlay.maskIds?.length}, data length: ${maskOverlay.data?.length}`);

  const file = bucket.file(storagePath);
  const jsonData = JSON.stringify(maskOverlay);
  console.log(`[storage] JSON data size: ${jsonData.length} bytes`);

  await file.save(Buffer.from(jsonData, "utf-8"), {
    contentType: "application/json",
    resumable: false,
    validation: "md5",
  });
  console.log(`[storage] uploadMaskOverlay - upload complete`);
  maskOverlayCache.set(storagePath, maskOverlay);
};

/**
 * Download maskOverlay JSON from storage
 */
export const downloadMaskOverlay = async (
  storagePath: string
): Promise<MaskOverlay | null> => {
  console.log(`[storage] downloadMaskOverlay - path: ${storagePath}`);
  const cached = maskOverlayCache.get(storagePath);
  if (cached) {
    console.log(`[storage] downloadMaskOverlay - cache hit`);
    return cached;
  }
  const file = bucket.file(storagePath);

  console.log(`[storage] Checking if file exists...`);
  const [exists] = await file.exists();
  console.log(`[storage] File exists: ${exists}`);

  if (!exists) {
    console.log(`[storage] File not found, returning null`);
    return null;
  }

  console.log(`[storage] Downloading file...`);
  const [buffer] = await file.download();
  console.log(`[storage] Downloaded buffer size: ${buffer.length} bytes`);

  const jsonString = buffer.toString("utf-8");
  console.log(`[storage] JSON string length: ${jsonString.length} chars`);

  const parsed = JSON.parse(jsonString);
  console.log(`[storage] Parsed maskOverlay - width: ${parsed?.width}, height: ${parsed?.height}, maskIds: ${parsed?.maskIds?.length}, data length: ${parsed?.data?.length}`);

  if (parsed) {
    maskOverlayCache.set(storagePath, parsed);
  }
  return parsed;
};
