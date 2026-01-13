import { storage } from "../firebase";
import { config } from "../config";
import { HttpError } from "../middleware/error";

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
