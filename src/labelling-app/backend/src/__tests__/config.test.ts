/**
 * Author: Xiaotian Lou
 * Date: 2026-03-04
 * Purpose: Unit tests for environment variable loading and configuration validation.
 */
/**
 * Unit tests for src/config.ts
 *
 * Because config.ts evaluates everything at module load time,
 * each group of tests uses vi.resetModules() + dynamic import to
 * re-execute the module with fresh process.env values.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";

// Save original env so we can restore it after each test
const originalEnv = { ...process.env };

// Mock dotenv to prevent reading actual .env files
vi.mock("dotenv", () => ({
  default: { config: vi.fn() },
  config: vi.fn(),
}));

// Mock fs to control existsSync behavior
const mockExistsSync = vi.fn().mockReturnValue(false);
vi.mock("node:fs", () => ({
  default: { existsSync: (...args: unknown[]) => mockExistsSync(...args) },
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

async function loadConfig() {
  vi.resetModules();
  const mod = await import("../config");
  return mod;
}

beforeEach(() => {
  // Restore env to original before each test
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, originalEnv);
  // Clear any test-specific keys
  delete process.env.PORT;
  delete process.env.MAX_IMAGE_MB;
  delete process.env.MEMORY_GC_THRESHOLD_MB;
  delete process.env.CACHE_COLORMAP_MB;
  delete process.env.ALLOWED_ORIGINS;
  delete process.env.REQUIRE_AUTH;
  delete process.env.FIREBASE_PROJECT_ID;
  delete process.env.FIREBASE_STORAGE_BUCKET;
  delete process.env.BACKEND_ENV_PATH;
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.FIREBASE_DATABASE_ID;
  delete process.env.FIREBASE_ID_TOKEN_URL;
  delete process.env.STORAGE_SIGNED_URL_TTL_MS;

  mockExistsSync.mockReturnValue(false);
})

afterEach(() => {
  // Make sure we restore env
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, originalEnv);
})

describe("config - default values", () => {
  it("uses default port 8080 when PORT is not set", async () => {
    const { config } = await loadConfig();
    expect(config.port).toBe(8080);
  });

  it("uses default maxImageMb of 50 when MAX_IMAGE_MB is not set", async () => {
    const { config } = await loadConfig();
    expect(config.maxImageMb).toBe(50);
  });

  it("uses default cacheColorMapMb of 32 when not set", async () => {
    const { config } = await loadConfig();
    expect(config.cacheColorMapMb).toBe(32);
  });

  it("requireAuth defaults to true when REQUIRE_AUTH is not set", async () => {
    const { config } = await loadConfig();
    expect(config.requireAuth).toBe(true);
  });

  it("allowedOrigins defaults to empty array when ALLOWED_ORIGINS is not set", async () => {
    const { config } = await loadConfig();
    expect(config.allowedOrigins).toEqual([]);
  });

  it("allowAllOrigins is false by default", async () => {
    const { config } = await loadConfig();
    expect(config.allowAllOrigins).toBe(false);
  });
});

describe("config - env var overrides", () => {
  it("reads PORT from environment", async () => {
    process.env.PORT = "9090";
    const { config } = await loadConfig();
    expect(config.port).toBe(9090);
  });

  it("reads MAX_IMAGE_MB from environment", async () => {
    process.env.MAX_IMAGE_MB = "100";
    const { config } = await loadConfig();
    expect(config.maxImageMb).toBe(100);
  });

  it("returns fallback when MAX_IMAGE_MB is not a valid number", async () => {
    process.env.MAX_IMAGE_MB = "not-a-number";
    const { config } = await loadConfig();
    expect(config.maxImageMb).toBe(50); // fallback
  });

  it("sets requireAuth to false when REQUIRE_AUTH=false", async () => {
    process.env.REQUIRE_AUTH = "false";
    const { config } = await loadConfig();
    expect(config.requireAuth).toBe(false);
  });

  it("sets requireAuth to true for any value other than 'false'", async () => {
    process.env.REQUIRE_AUTH = "true";
    const { config } = await loadConfig();
    expect(config.requireAuth).toBe(true);
  });

  it("parses ALLOWED_ORIGINS as a comma-separated array", async () => {
    process.env.ALLOWED_ORIGINS = "http://localhost:3000, https://example.com";
    const { config } = await loadConfig();
    expect(config.allowedOrigins).toEqual(["http://localhost:3000", "https://example.com"]);
  });

  it("sets allowAllOrigins to true when ALLOWED_ORIGINS includes *", async () => {
    process.env.ALLOWED_ORIGINS = "*";
    const { config } = await loadConfig();
    expect(config.allowAllOrigins).toBe(true);
  });

  it("reads FIREBASE_PROJECT_ID from environment", async () => {
    process.env.FIREBASE_PROJECT_ID = "my-project";
    const { config } = await loadConfig();
    expect(config.firebaseProjectId).toBe("my-project");
  });

  it("reads FIREBASE_DATABASE_ID from environment", async () => {
    process.env.FIREBASE_DATABASE_ID = "my-db";
    const { config } = await loadConfig();
    expect(config.firebaseDatabaseId).toBe("my-db");
  });

  it("defaults firebaseDatabaseId to empty string when not set", async () => {
    const { config } = await loadConfig();
    expect(config.firebaseDatabaseId).toBe("");
  });

  it("reads PUBLIC_BASE_URL from environment", async () => {
    process.env.PUBLIC_BASE_URL = "https://api.example.com";
    const { config } = await loadConfig();
    expect(config.publicBaseUrl).toBe("https://api.example.com");
  });

  it("reads STORAGE_SIGNED_URL_TTL_MS from environment", async () => {
    process.env.STORAGE_SIGNED_URL_TTL_MS = "60000";
    const { config } = await loadConfig();
    expect(config.storageSignedUrlTtlMs).toBe(60000);
  });
});

describe("resolveEnvPath", () => {
  it("uses BACKEND_ENV_PATH when set", async () => {
    process.env.BACKEND_ENV_PATH = "/custom/path/.env";
    const { default: dotenv } = await import("dotenv");
    await loadConfig();
    expect(vi.mocked(dotenv.config)).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/custom/path/.env" })
    );
  });

  it("uses monorepo path when backend/.env exists", async () => {
    const cwd = process.cwd();
    const monorepoPath = path.resolve(cwd, "backend", ".env");
    mockExistsSync.mockImplementation((p: string) => p === monorepoPath);

    const { default: dotenv } = await import("dotenv");
    await loadConfig();
    expect(vi.mocked(dotenv.config)).toHaveBeenCalledWith(
      expect.objectContaining({ path: monorepoPath })
    );
  });

  it("uses local .env path when it exists and monorepo path does not", async () => {
    const cwd = process.cwd();
    const monorepoPath = path.resolve(cwd, "backend", ".env");
    const localPath = path.resolve(cwd, ".env");
    mockExistsSync.mockImplementation((p: string) => p === localPath && p !== monorepoPath);

    const { default: dotenv } = await import("dotenv");
    await loadConfig();
    expect(vi.mocked(dotenv.config)).toHaveBeenCalledWith(
      expect.objectContaining({ path: localPath })
    );
  });

  it("passes undefined path when no env file is found", async () => {
    mockExistsSync.mockReturnValue(false);
    const { default: dotenv } = await import("dotenv");
    await loadConfig();
    expect(vi.mocked(dotenv.config)).toHaveBeenCalledWith(
      expect.objectContaining({ path: undefined })
    );
  });
});

describe("requiredConfig", () => {
  it("returns the firebase project id when set", async () => {
    process.env.FIREBASE_PROJECT_ID = "proj-123";
    const { requiredConfig } = await loadConfig();
    expect(requiredConfig.firebaseProjectId()).toBe("proj-123");
  });

  it("throws when FIREBASE_PROJECT_ID is not set", async () => {
    delete process.env.FIREBASE_PROJECT_ID;
    const { requiredConfig } = await loadConfig();
    expect(() => requiredConfig.firebaseProjectId()).toThrow("Missing required env var");
  });

  it("returns the firebase storage bucket when set", async () => {
    process.env.FIREBASE_STORAGE_BUCKET = "bucket-abc";
    const { requiredConfig } = await loadConfig();
    expect(requiredConfig.firebaseStorageBucket()).toBe("bucket-abc");
  });

  it("throws when FIREBASE_STORAGE_BUCKET is not set", async () => {
    delete process.env.FIREBASE_STORAGE_BUCKET;
    const { requiredConfig } = await loadConfig();
    expect(() => requiredConfig.firebaseStorageBucket()).toThrow("Missing required env var");
  });
});
