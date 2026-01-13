import dotenv from "dotenv";

dotenv.config({ path: process.env.BACKEND_ENV_PATH || undefined });

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

export const config = {
  port: optionalNumber("PORT", 8080),
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID,
  firebaseStorageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  sam3Endpoint: process.env.SAM3_ENDPOINT || "",
  sam3ModelName: process.env.SAM3_MODEL_NAME || "sam3",
  sam3TimeoutMs: optionalNumber("SAM3_TIMEOUT_MS", 60000),
  maxImageMb: optionalNumber("MAX_IMAGE_MB", 50),
  requireAuth: process.env.REQUIRE_AUTH !== "false",
  allowedOrigins: (process.env.ALLOWED_ORIGINS || "").split(",").map((entry) => entry.trim()).filter(Boolean),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "",
  firebaseIdTokenUrl: process.env.FIREBASE_ID_TOKEN_URL || "",
  storageSignedUrlTtlMs: optionalNumber("STORAGE_SIGNED_URL_TTL_MS", 5 * 60 * 1000),
};

export const requiredConfig = {
  firebaseProjectId: () => required("FIREBASE_PROJECT_ID", config.firebaseProjectId),
  firebaseStorageBucket: () => required("FIREBASE_STORAGE_BUCKET", config.firebaseStorageBucket),
};
