import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const resolveEnvPath = () => {
  if (process.env.BACKEND_ENV_PATH) {
    return process.env.BACKEND_ENV_PATH;
  }

  const cwd = process.cwd();
  const monorepoPath = path.resolve(cwd, "backend", ".env");
  if (fs.existsSync(monorepoPath)) {
    return monorepoPath;
  }

  const localPath = path.resolve(cwd, ".env");
  if (fs.existsSync(localPath)) {
    return localPath;
  }

  return undefined;
};

dotenv.config({ path: resolveEnvPath() });

const required = (key: string, fallback?: string) => {
  const value = process.env[key] ?? fallback;
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
};

const optionalNumber = (key: string, fallback: number) => {
  const raw = process.env[key];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return parsed;
};

const sam2InternalPort = optionalNumber("SAM2_INTERNAL_PORT", 9000);
const maxImageMb = optionalNumber("MAX_IMAGE_MB", 50);
const maskChunkRows = optionalNumber("MASK_CHUNK_ROWS", 256);
const maskChunkTtlMs = optionalNumber("MASK_CHUNK_TTL_MS", 5 * 60 * 1000);
const memoryGcThresholdMb = optionalNumber("MEMORY_GC_THRESHOLD_MB", 0);
const memoryGcIntervalMs = optionalNumber("MEMORY_GC_INTERVAL_MS", 0);

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const allowAllOrigins = allowedOrigins.includes("*");

export const config = {
  port: optionalNumber("PORT", 8080),
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID,
  firebaseStorageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  firebaseDatabaseId: process.env.FIREBASE_DATABASE_ID || "",
  sam2InternalPort,
  sam2Endpoint:
    process.env.SAM2_ENDPOINT || `http://127.0.0.1:${sam2InternalPort}`,
  sam2ModelName: process.env.SAM2_MODEL_NAME || "sam2",
  sam2TimeoutMs: optionalNumber("SAM2_TIMEOUT_MS", 60000),
  sam2RetryCount: optionalNumber("SAM2_RETRY_COUNT", 5),
  sam2RetryDelayMs: optionalNumber("SAM2_RETRY_DELAY_MS", 2000),
  maxImageMb,
  MaxImageMb: maxImageMb,
  maskChunkRows,
  maskChunkTtlMs,
  memoryGcThresholdMb,
  memoryGcIntervalMs,
  requireAuth: process.env.REQUIRE_AUTH !== "false",
  allowedOrigins,
  allowAllOrigins,
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "",
  firebaseIdTokenUrl: process.env.FIREBASE_ID_TOKEN_URL || "",
  storageSignedUrlTtlMs: optionalNumber("STORAGE_SIGNED_URL_TTL_MS", 5 * 60 * 1000),
};

export const requiredConfig = {
  firebaseProjectId: () => required("FIREBASE_PROJECT_ID", config.firebaseProjectId),
  firebaseStorageBucket: () => required("FIREBASE_STORAGE_BUCKET", config.firebaseStorageBucket),
};
