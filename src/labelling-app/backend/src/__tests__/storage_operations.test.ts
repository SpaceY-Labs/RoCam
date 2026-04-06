/**
 * Author: Xiaotian Lou
 * Date: 2026-03-04
 * Purpose: Unit tests for Firebase Storage upload, download, and delete operations.
 */
/**
 * Unit tests for Firebase Storage operations in src/services/storage.ts
 *
 * Mocks firebase bucket, config, and cache to test all upload/download
 * operations and error paths without real network calls.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock caches
// ---------------------------------------------------------------------------
const { colorMapCacheMock, maskOverlayCacheMock, maskBufferCacheMock } = vi.hoisted(() => {
  const colorMapCacheMock = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
  const maskOverlayCacheMock = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
  const maskBufferCacheMock = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
  return { colorMapCacheMock, maskOverlayCacheMock, maskBufferCacheMock };
});

vi.mock("../services/cache", () => ({
  colorMapCache: colorMapCacheMock,
  maskOverlayCache: maskOverlayCacheMock,
  maskBufferCache: maskBufferCacheMock,
  createLruCache: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock firebase – returns a controllable bucket mock
// ---------------------------------------------------------------------------
const { fileMock, bucketMock } = vi.hoisted(() => {
  const fileMock = {
    save: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue([true]),
    delete: vi.fn().mockResolvedValue(undefined),
    createReadStream: vi.fn().mockReturnValue("stream"),
    getMetadata: vi.fn().mockResolvedValue([{ size: 100 }]),
    getSignedUrl: vi.fn().mockResolvedValue(["https://signed-url"]),
    download: vi.fn().mockResolvedValue([Buffer.from(JSON.stringify({ ok: true }))]),
  };
  const bucketMock = {
    file: vi.fn().mockReturnValue(fileMock),
  };
  return { fileMock, bucketMock };
});

vi.mock("../firebase", () => ({
  storage: { bucket: vi.fn().mockReturnValue(bucketMock) },
  auth: { verifyIdToken: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mock config
// ---------------------------------------------------------------------------
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
  uploadImageBuffer,
  deleteFileIfExists,
  getFileStream,
  getFileMetadata,
  getSignedReadUrl,
  uploadMaskBuffer,
  downloadMaskBuffer,
  uploadColorMap,
  downloadColorMap,
  uploadMaskOverlay,
  downloadMaskOverlay,
} from "../services/storage";

beforeEach(() => {
  vi.clearAllMocks();
  // Reset default behaviors
  fileMock.save.mockResolvedValue(undefined);
  fileMock.exists.mockResolvedValue([true]);
  fileMock.delete.mockResolvedValue(undefined);
  fileMock.createReadStream.mockReturnValue("stream");
  fileMock.getMetadata.mockResolvedValue([{ size: 100 }]);
  fileMock.getSignedUrl.mockResolvedValue(["https://signed-url"]);
  fileMock.download.mockResolvedValue([Buffer.from(JSON.stringify({ ok: true }))]);
  bucketMock.file.mockReturnValue(fileMock);
  colorMapCacheMock.get.mockReturnValue(undefined);
  maskOverlayCacheMock.get.mockReturnValue(undefined);
  maskBufferCacheMock.get.mockReturnValue(undefined);
});

// ---------------------------------------------------------------------------
// uploadImageBuffer
// ---------------------------------------------------------------------------
describe("uploadImageBuffer", () => {
  it("calls file.save with correct content type", async () => {
    const buf = Buffer.from("image data");
    await uploadImageBuffer("path/to/image.jpg", buf, "image/jpeg");
    expect(bucketMock.file).toHaveBeenCalledWith("path/to/image.jpg");
    expect(fileMock.save).toHaveBeenCalledWith(
      buf,
      expect.objectContaining({ contentType: "image/jpeg" })
    );
  });

  it("returns the file reference", async () => {
    const result = await uploadImageBuffer("path/img", Buffer.from(""), "image/png");
    expect(result).toBe(fileMock);
  });
});

// ---------------------------------------------------------------------------
// deleteFileIfExists
// ---------------------------------------------------------------------------
describe("deleteFileIfExists", () => {
  it("deletes the file when it exists", async () => {
    fileMock.exists.mockResolvedValue([true]);
    await deleteFileIfExists("path/to/file");
    expect(fileMock.delete).toHaveBeenCalledOnce();
  });

  it("does not delete when file does not exist", async () => {
    fileMock.exists.mockResolvedValue([false]);
    await deleteFileIfExists("path/to/file");
    expect(fileMock.delete).not.toHaveBeenCalled();
  });

  it("invalidates all caches for the storage path", async () => {
    fileMock.exists.mockResolvedValue([false]);
    await deleteFileIfExists("some/path");
    expect(colorMapCacheMock.delete).toHaveBeenCalledWith("some/path");
    expect(maskOverlayCacheMock.delete).toHaveBeenCalledWith("some/path");
    expect(maskBufferCacheMock.delete).toHaveBeenCalledWith("some/path");
  });
});

// ---------------------------------------------------------------------------
// getFileStream
// ---------------------------------------------------------------------------
describe("getFileStream", () => {
  it("returns a read stream when file exists", async () => {
    fileMock.exists.mockResolvedValue([true]);
    const stream = await getFileStream("path/to/file");
    expect(stream).toBe("stream");
  });

  it("throws HttpError 404 when file does not exist", async () => {
    fileMock.exists.mockResolvedValue([false]);
    await expect(getFileStream("missing/file")).rejects.toMatchObject({
      status: 404,
    });
  });
});

// ---------------------------------------------------------------------------
// getFileMetadata
// ---------------------------------------------------------------------------
describe("getFileMetadata", () => {
  it("returns metadata from storage", async () => {
    fileMock.getMetadata.mockResolvedValue([{ size: 512, contentType: "image/jpeg" }]);
    const meta = await getFileMetadata("path/file");
    expect(meta).toEqual({ size: 512, contentType: "image/jpeg" });
  });
});

// ---------------------------------------------------------------------------
// getSignedReadUrl
// ---------------------------------------------------------------------------
describe("getSignedReadUrl", () => {
  it("returns a signed URL", async () => {
    fileMock.getSignedUrl.mockResolvedValue(["https://storage.googleapis.com/signed"]);
    const url = await getSignedReadUrl("path/file");
    expect(url).toBe("https://storage.googleapis.com/signed");
  });

  it("calls getSignedUrl with read action", async () => {
    await getSignedReadUrl("path/file");
    expect(fileMock.getSignedUrl).toHaveBeenCalledWith(
      expect.objectContaining({ action: "read" })
    );
  });
});

// ---------------------------------------------------------------------------
// uploadMaskBuffer / downloadMaskBuffer
// ---------------------------------------------------------------------------
describe("uploadMaskBuffer", () => {
  it("saves buffer to storage and sets cache", async () => {
    const buf = Buffer.from([0, 1, 2]);
    await uploadMaskBuffer("masks/path.bin", buf);
    expect(fileMock.save).toHaveBeenCalledWith(
      buf,
      expect.objectContaining({ contentType: "application/octet-stream" })
    );
    expect(maskBufferCacheMock.set).toHaveBeenCalledWith("masks/path.bin", buf);
  });
});

describe("downloadMaskBuffer", () => {
  it("returns cached buffer without downloading", async () => {
    const cached = Buffer.from([9, 8, 7]);
    maskBufferCacheMock.get.mockReturnValue(cached);
    const result = await downloadMaskBuffer("masks/path.bin");
    expect(result).toBe(cached);
    expect(fileMock.download).not.toHaveBeenCalled();
  });

  it("downloads from storage when cache miss and file exists", async () => {
    const downloaded = Buffer.from([1, 2, 3]);
    maskBufferCacheMock.get.mockReturnValue(undefined);
    fileMock.exists.mockResolvedValue([true]);
    fileMock.download.mockResolvedValue([downloaded]);
    const result = await downloadMaskBuffer("masks/path.bin");
    expect(result).toEqual(downloaded);
    expect(maskBufferCacheMock.set).toHaveBeenCalledWith("masks/path.bin", downloaded);
  });

  it("throws HttpError 404 when mask file does not exist", async () => {
    maskBufferCacheMock.get.mockReturnValue(undefined);
    fileMock.exists.mockResolvedValue([false]);
    await expect(downloadMaskBuffer("masks/missing.bin")).rejects.toMatchObject({
      status: 404,
    });
  });
});

// ---------------------------------------------------------------------------
// uploadColorMap / downloadColorMap
// ---------------------------------------------------------------------------
describe("uploadColorMap", () => {
  it("saves JSON-encoded colorMap to storage", async () => {
    const colorMap = { "0": { "0": "#ff0000" } };
    await uploadColorMap("path/colormap.json", colorMap);
    expect(fileMock.save).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({ contentType: "application/json" })
    );
    const savedBuf: Buffer = fileMock.save.mock.calls[0][0];
    expect(JSON.parse(savedBuf.toString("utf-8"))).toEqual(colorMap);
    expect(colorMapCacheMock.set).toHaveBeenCalledWith("path/colormap.json", colorMap);
  });
});

describe("downloadColorMap", () => {
  it("returns cached colorMap without downloading", async () => {
    const cached = { "0": { "0": "#aabbcc" } };
    colorMapCacheMock.get.mockReturnValue(cached);
    const result = await downloadColorMap("path/colormap.json");
    expect(result).toBe(cached);
    expect(fileMock.download).not.toHaveBeenCalled();
  });

  it("returns empty object when file does not exist", async () => {
    colorMapCacheMock.get.mockReturnValue(undefined);
    fileMock.exists.mockResolvedValue([false]);
    const result = await downloadColorMap("path/colormap.json");
    expect(result).toEqual({});
  });

  it("downloads and parses JSON when file exists", async () => {
    colorMapCacheMock.get.mockReturnValue(undefined);
    fileMock.exists.mockResolvedValue([true]);
    const colorMap = { "1": { "2": "#112233" } };
    fileMock.download.mockResolvedValue([Buffer.from(JSON.stringify(colorMap))]);
    const result = await downloadColorMap("path/colormap.json");
    expect(result).toEqual(colorMap);
    expect(colorMapCacheMock.set).toHaveBeenCalledWith("path/colormap.json", colorMap);
  });
});

// ---------------------------------------------------------------------------
// uploadMaskOverlay / downloadMaskOverlay
// ---------------------------------------------------------------------------
describe("uploadMaskOverlay", () => {
  it("saves JSON-encoded mask overlay to storage", async () => {
    const overlay = { width: 2, height: 2, maskIds: ["m1"], data: [-1, 0, -1, -1] };
    await uploadMaskOverlay("path/overlay.json", overlay);
    expect(fileMock.save).toHaveBeenCalled();
    expect(maskOverlayCacheMock.set).toHaveBeenCalledWith("path/overlay.json", overlay);
  });
});

describe("downloadMaskOverlay", () => {
  it("returns cached overlay without downloading", async () => {
    const cached = { width: 1, height: 1, maskIds: [], data: [-1] };
    maskOverlayCacheMock.get.mockReturnValue(cached);
    const result = await downloadMaskOverlay("path/overlay.json");
    expect(result).toBe(cached);
    expect(fileMock.download).not.toHaveBeenCalled();
  });

  it("returns null when file does not exist", async () => {
    maskOverlayCacheMock.get.mockReturnValue(undefined);
    fileMock.exists.mockResolvedValue([false]);
    const result = await downloadMaskOverlay("path/overlay.json");
    expect(result).toBeNull();
  });

  it("downloads and parses overlay JSON when file exists", async () => {
    maskOverlayCacheMock.get.mockReturnValue(undefined);
    fileMock.exists.mockResolvedValue([true]);
    const overlay = { width: 3, height: 3, maskIds: ["m1", "m2"], data: Array(9).fill(-1) };
    fileMock.download.mockResolvedValue([Buffer.from(JSON.stringify(overlay))]);
    const result = await downloadMaskOverlay("path/overlay.json");
    expect(result).toEqual(overlay);
    expect(maskOverlayCacheMock.set).toHaveBeenCalledWith("path/overlay.json", overlay);
  });
});
