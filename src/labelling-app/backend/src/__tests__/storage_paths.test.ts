import { describe, it, expect, vi } from "vitest";

// Mock firebase and config to prevent real initialization
vi.mock("../firebase", () => ({
  storage: { bucket: vi.fn().mockReturnValue({}) },
  auth: { verifyIdToken: vi.fn() },
}));
vi.mock("../config", () => ({
  config: {
    cacheColorMapMb: 32,
    cacheMaskOverlayMb: 64,
    cacheMaskBinaryMb: 64,
    cacheColorMapTtlMs: 300000,
    cacheMaskOverlayTtlMs: 300000,
    cacheMaskBinaryTtlMs: 300000,
    storageSignedUrlTtlMs: 300000,
  },
}));

import {
  buildMaskStoragePath,
  buildColorMapStoragePath,
  buildMaskOverlayStoragePath,
} from "../services/storage";

// ============================================================================
// Storage path builders (pure string functions – no I/O)
// ============================================================================
describe("buildMaskStoragePath", () => {
  it("builds the correct path for a mask file", () => {
    const path = buildMaskStoragePath("proj-1", "img-2", "mask-3");
    expect(path).toBe("projects/proj-1/images/img-2/masks/mask-3.bin");
  });
});

describe("buildColorMapStoragePath", () => {
  it("builds the correct path for a colorMap file", () => {
    const path = buildColorMapStoragePath("proj-1", "maskmap-99");
    expect(path).toBe("projects/proj-1/maskmaps/maskmap-99/colormap.json");
  });
});

describe("buildMaskOverlayStoragePath", () => {
  it("builds the correct path for a maskOverlay file", () => {
    const path = buildMaskOverlayStoragePath("proj-1", "maskmap-99");
    expect(path).toBe("projects/proj-1/maskmaps/maskmap-99/maskoverlay.json");
  });
});
