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

const sam3InternalPort = optionalNumber("SAM3_INTERNAL_PORT", 9000);
const maxImageMb = optionalNumber("MAX_IMAGE_MB", 50);

export const config = {
  port: optionalNumber("PORT", 8080),
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID,
  firebaseStorageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  firebaseDatabaseId: process.env.FIREBASE_DATABASE_ID || "",
  sam3InternalPort,
  sam3Endpoint:
    process.env.SAM3_ENDPOINT || `http://127.0.0.1:${sam3InternalPort}`,
  sam3ModelName: process.env.SAM3_MODEL_NAME || "sam3",
  sam3TimeoutMs: optionalNumber("SAM3_TIMEOUT_MS", 60000),
  maxImageMb,
  MaxImageMb: maxImageMb,
  requireAuth: process.env.REQUIRE_AUTH !== "false",
  allowedOrigins: (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "",
  firebaseIdTokenUrl: process.env.FIREBASE_ID_TOKEN_URL || "",
  storageSignedUrlTtlMs: optionalNumber("STORAGE_SIGNED_URL_TTL_MS", 5 * 60 * 1000),
};

export const requiredConfig = {
  firebaseProjectId: () => required("FIREBASE_PROJECT_ID", config.firebaseProjectId),
  firebaseStorageBucket: () => required("FIREBASE_STORAGE_BUCKET", config.firebaseStorageBucket),
};
