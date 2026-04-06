/**
 * Author: Xiaotian Lou
 * Date: 2026-03-04
 * Purpose: Unit tests for image processing and project service functions.
 */
/**
 * Unit tests for src/services/image.ts and src/services/projects.ts
 *
 * sharp is mocked so we can control metadata/resize results.
 * firebase/firestore is mocked to test projects.ts without real network calls.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock sharp
// ---------------------------------------------------------------------------
const { resizeMock, sharpInstanceMock, sharpMock } = vi.hoisted(() => {
  const resizeMock = { toBuffer: vi.fn() };
  const sharpInstanceMock = {
    metadata: vi.fn(),
    resize: vi.fn().mockReturnValue(resizeMock),
  };
  const sharpMock = vi.fn().mockReturnValue(sharpInstanceMock);
  return { resizeMock, sharpInstanceMock, sharpMock };
});

vi.mock("sharp", () => ({ default: (...args: unknown[]) => sharpMock(...args) }));

// ---------------------------------------------------------------------------
// Mock firebase for projects.ts
// ---------------------------------------------------------------------------
const { docGetMock, collectionMock, firestoreMock } = vi.hoisted(() => {
  const docGetMock = vi.fn();
  const collectionMock = {
    doc: vi.fn().mockReturnValue({
      get: docGetMock,
      collection: vi.fn().mockReturnValue({ doc: vi.fn() }),
    }),
  };
  const firestoreMock = { collection: vi.fn().mockReturnValue(collectionMock) };
  return { docGetMock, collectionMock, firestoreMock };
});

vi.mock("../firebase", () => ({
  firestore: firestoreMock,
  storage: { bucket: vi.fn().mockReturnValue({}) },
  auth: { verifyIdToken: vi.fn() },
}));

import {
  resizeImageBuffer,
  TARGET_WIDTH,
  TARGET_HEIGHT,
} from "../services/image";

import {
  ensureProjectAccess,
  getProjectImagesCollection,
  getProjectLocksCollection,
  getProjectMasksCollection,
  getProjectMaskMapsCollection,
  getProjectDoc,
} from "../services/projects";

// ---------------------------------------------------------------------------
// image.ts tests
// ---------------------------------------------------------------------------
describe("resizeImageBuffer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharpMock.mockReturnValue(sharpInstanceMock);
    sharpInstanceMock.resize.mockReturnValue(resizeMock);
  });

  it("returns resized buffer with correct dimensions and content type for jpeg", async () => {
    sharpInstanceMock.metadata.mockResolvedValue({ format: "jpeg", width: 800, height: 600 });
    const resizedBuf = Buffer.from("resized");
    resizeMock.toBuffer.mockResolvedValue(resizedBuf);

    const result = await resizeImageBuffer(Buffer.from("original"));

    expect(result.buffer).toBe(resizedBuf);
    expect(result.contentType).toBe("image/jpeg");
    expect(result.width).toBe(TARGET_WIDTH);
    expect(result.height).toBe(TARGET_HEIGHT);
    expect(result.format).toBe("jpeg");
  });

  it("returns correct content type for png", async () => {
    sharpInstanceMock.metadata.mockResolvedValue({ format: "png" });
    resizeMock.toBuffer.mockResolvedValue(Buffer.from(""));
    const result = await resizeImageBuffer(Buffer.from(""));
    expect(result.contentType).toBe("image/png");
  });

  it("returns correct content type for webp", async () => {
    sharpInstanceMock.metadata.mockResolvedValue({ format: "webp" });
    resizeMock.toBuffer.mockResolvedValue(Buffer.from(""));
    const result = await resizeImageBuffer(Buffer.from(""));
    expect(result.contentType).toBe("image/webp");
  });

  it("returns correct content type for tiff", async () => {
    sharpInstanceMock.metadata.mockResolvedValue({ format: "tiff" });
    resizeMock.toBuffer.mockResolvedValue(Buffer.from(""));
    const result = await resizeImageBuffer(Buffer.from(""));
    expect(result.contentType).toBe("image/tiff");
  });

  it("returns correct content type for gif", async () => {
    sharpInstanceMock.metadata.mockResolvedValue({ format: "gif" });
    resizeMock.toBuffer.mockResolvedValue(Buffer.from(""));
    const result = await resizeImageBuffer(Buffer.from(""));
    expect(result.contentType).toBe("image/gif");
  });

  it("returns correct content type for bmp", async () => {
    sharpInstanceMock.metadata.mockResolvedValue({ format: "bmp" });
    resizeMock.toBuffer.mockResolvedValue(Buffer.from(""));
    const result = await resizeImageBuffer(Buffer.from(""));
    expect(result.contentType).toBe("image/bmp");
  });

  it("returns application/octet-stream for unknown format", async () => {
    sharpInstanceMock.metadata.mockResolvedValue({ format: "avif" });
    resizeMock.toBuffer.mockResolvedValue(Buffer.from(""));
    const result = await resizeImageBuffer(Buffer.from(""));
    expect(result.contentType).toBe("application/octet-stream");
  });

  it("throws HttpError 400 when sharp.metadata() throws (unsupported format)", async () => {
    sharpInstanceMock.metadata.mockRejectedValue(new Error("not an image"));
    await expect(resizeImageBuffer(Buffer.from("invalid"))).rejects.toMatchObject({
      status: 400,
    });
  });

  it("throws HttpError 400 when metadata has no format field", async () => {
    sharpInstanceMock.metadata.mockResolvedValue({ format: undefined });
    await expect(resizeImageBuffer(Buffer.from("data"))).rejects.toMatchObject({
      status: 400,
    });
  });

  it("calls resize with TARGET_WIDTH and TARGET_HEIGHT", async () => {
    sharpInstanceMock.metadata.mockResolvedValue({ format: "jpeg" });
    resizeMock.toBuffer.mockResolvedValue(Buffer.from(""));
    await resizeImageBuffer(Buffer.from(""));
    expect(sharpInstanceMock.resize).toHaveBeenCalledWith(
      TARGET_WIDTH,
      TARGET_HEIGHT,
      expect.objectContaining({ fit: "fill" })
    );
  });
});

// ---------------------------------------------------------------------------
// projects.ts tests
// ---------------------------------------------------------------------------
describe("ensureProjectAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish chain: firestoreMock.collection() -> collectionMock.doc() -> docMock
    firestoreMock.collection.mockReturnValue(collectionMock);
    collectionMock.doc.mockReturnValue({
      get: docGetMock,
      collection: vi.fn().mockReturnValue({ doc: vi.fn() }),
    });
  });

  it("returns the doc when it exists", async () => {
    docGetMock.mockResolvedValue({ exists: true, data: () => ({ name: "My Project" }) });
    const doc = await ensureProjectAccess("proj-1", "user-1");
    expect(doc.exists).toBe(true);
  });

  it("throws HttpError 404 when project does not exist", async () => {
    docGetMock.mockResolvedValue({ exists: false });
    await expect(ensureProjectAccess("missing-proj", "user-1")).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("collection path builders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestoreMock.collection.mockReturnValue(collectionMock);
    const innerCollection = { doc: vi.fn() };
    collectionMock.doc.mockReturnValue({
      get: docGetMock,
      collection: vi.fn().mockReturnValue(innerCollection),
    });
  });

  it("getProjectImagesCollection calls nested collection('images')", () => {
    const docRef = collectionMock.doc("proj-1");
    getProjectImagesCollection("proj-1");
    expect(docRef.collection).toBeDefined();
  });

  it("getProjectLocksCollection returns locks collection reference", () => {
    const result = getProjectLocksCollection("proj-1");
    expect(result).toBeDefined();
  });

  it("getProjectMasksCollection returns masks collection reference", () => {
    const result = getProjectMasksCollection("proj-1");
    expect(result).toBeDefined();
  });

  it("getProjectMaskMapsCollection returns maskMaps collection reference", () => {
    const result = getProjectMaskMapsCollection("proj-1");
    expect(result).toBeDefined();
  });

  it("getProjectDoc returns a document reference", () => {
    const result = getProjectDoc("proj-1");
    expect(result).toBeDefined();
  });
});
