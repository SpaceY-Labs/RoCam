/**
 * Unit tests for src/services/masks.ts
 *
 * Tests all pure-logic functions without requiring Firebase or real Feather data.
 * apache-arrow's tableFromIPC is mocked to control parseFeatherMask behavior.
 */

// Mock apache-arrow before importing the module under test
vi.mock("apache-arrow", () => ({
  tableFromIPC: vi.fn(),
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { tableFromIPC } from "apache-arrow";

import {
  binaryMaskToSparse,
  sparseToBinaryMask,
  mergeSparseData,
  getMaskIndices,
  isSparseDataEmpty,
  parseFeatherMask,
  serializeMaskForStorage,
  mergeMasksForStorage,
  createEmptyMask,
  addMaskAtPixel,
  removeMaskAtPixel,
  getMaskIndicesAtPixel,
  getBaseName,
  getMaskImageBaseName,
  sparseMaskDataToRawBinary,
  rawBinaryToSparseMask,
  prepareMaskFromParsed,
  createMaskMapFromMasks,
  generateMaskOverlay,
  computeColorMap,
  type SparseMaskData,
  type SparseBinaryMask,
  type ParsedMask,
} from "../services/masks";

// ---------------------------------------------------------------------------
// binaryMaskToSparse
// ---------------------------------------------------------------------------
describe("binaryMaskToSparse", () => {
  it("converts a single-pixel mask to sparse format", () => {
    // 2x2 mask with pixel [0][1] set
    const mask = new Uint8Array([0, 1, 0, 0]);
    const result = binaryMaskToSparse(mask, 2, 2, 0);
    expect(result["0"]["1"]).toEqual([0]);
    expect(result["0"]?.["0"]).toBeUndefined();
  });

  it("returns empty object for all-zero mask", () => {
    const mask = new Uint8Array([0, 0, 0, 0]);
    const result = binaryMaskToSparse(mask, 2, 2, 5);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("uses maskIndex in the sparse data value", () => {
    const mask = new Uint8Array([1, 0]);
    const result = binaryMaskToSparse(mask, 2, 1, 3);
    expect(result["0"]["0"]).toEqual([3]);
  });

  it("handles full mask (all pixels set)", () => {
    const mask = new Uint8Array([1, 1, 1, 1]);
    const result = binaryMaskToSparse(mask, 2, 2, 0);
    expect(result["0"]["0"]).toEqual([0]);
    expect(result["0"]["1"]).toEqual([0]);
    expect(result["1"]["0"]).toEqual([0]);
    expect(result["1"]["1"]).toEqual([0]);
  });

  it("correctly maps row/col indices", () => {
    // 3x1 mask: pixel at col=2
    const mask = new Uint8Array([0, 0, 1]);
    const result = binaryMaskToSparse(mask, 3, 1, 0);
    expect(result["0"]["2"]).toEqual([0]);
  });
});

// ---------------------------------------------------------------------------
// sparseToBinaryMask
// ---------------------------------------------------------------------------
describe("sparseToBinaryMask", () => {
  it("converts sparse format back to binary mask", () => {
    const data: SparseMaskData = { "0": { "1": [0] } };
    const result = sparseToBinaryMask(data, 2, 2, 0);
    expect(result[1]).toBe(1); // row=0, col=1 → index 0*2+1=1
    expect(result[0]).toBe(0);
  });

  it("returns empty mask when sparse data is empty", () => {
    const result = sparseToBinaryMask({}, 3, 3, 0);
    expect(Array.from(result)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("only extracts pixels for the given maskIndex", () => {
    const data: SparseMaskData = {
      "0": { "0": [0, 1] },
      "1": { "0": [1] },
    };
    const result = sparseToBinaryMask(data, 2, 2, 0);
    expect(result[0]).toBe(1); // row=0, col=0 has index 0
    expect(result[2]).toBe(0); // row=1, col=0 has only index 1
  });

  it("skips out-of-bounds rows and columns", () => {
    const data: SparseMaskData = {
      "-1": { "0": [0] },
      "5": { "0": [0] }, // row beyond height=2
      "0": { "-1": [0], "5": [0] }, // col out of bounds
    };
    const result = sparseToBinaryMask(data, 2, 2, 0);
    expect(Array.from(result)).toEqual([0, 0, 0, 0]);
  });
});

// ---------------------------------------------------------------------------
// Round-trip: binaryMaskToSparse <-> sparseToBinaryMask
// ---------------------------------------------------------------------------
describe("binaryMaskToSparse / sparseToBinaryMask round-trip", () => {
  it("recovers the original binary mask after round-trip", () => {
    const original = new Uint8Array([0, 1, 1, 0, 0, 1]);
    const sparse = binaryMaskToSparse(original, 3, 2, 0);
    const recovered = sparseToBinaryMask(sparse, 3, 2, 0);
    expect(Array.from(recovered)).toEqual(Array.from(original));
  });
});

// ---------------------------------------------------------------------------
// mergeSparseData
// ---------------------------------------------------------------------------
describe("mergeSparseData", () => {
  it("merges two non-overlapping masks", () => {
    const a: SparseMaskData = { "0": { "0": [0] } };
    const b: SparseMaskData = { "1": { "1": [1] } };
    const result = mergeSparseData([a, b]);
    expect(result["0"]["0"]).toEqual([0]);
    expect(result["1"]["1"]).toEqual([1]);
  });

  it("merges overlapping pixels, combining indices", () => {
    const a: SparseMaskData = { "0": { "0": [0] } };
    const b: SparseMaskData = { "0": { "0": [1] } };
    const result = mergeSparseData([a, b]);
    expect(result["0"]["0"]).toEqual([0, 1]);
  });

  it("does not duplicate indices for the same pixel", () => {
    const a: SparseMaskData = { "0": { "0": [0] } };
    const b: SparseMaskData = { "0": { "0": [0] } };
    const result = mergeSparseData([a, b]);
    expect(result["0"]["0"]).toEqual([0]);
  });

  it("keeps indices sorted", () => {
    const a: SparseMaskData = { "0": { "0": [2] } };
    const b: SparseMaskData = { "0": { "0": [1] } };
    const result = mergeSparseData([a, b]);
    expect(result["0"]["0"]).toEqual([1, 2]);
  });

  it("returns empty object for empty input", () => {
    expect(mergeSparseData([])).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// getMaskIndices
// ---------------------------------------------------------------------------
describe("getMaskIndices", () => {
  it("returns sorted unique indices", () => {
    const data: SparseMaskData = {
      "0": { "0": [2, 0], "1": [1] },
      "1": { "0": [0, 3] },
    };
    expect(getMaskIndices(data)).toEqual([0, 1, 2, 3]);
  });

  it("returns empty array for empty data", () => {
    expect(getMaskIndices({})).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// isSparseDataEmpty
// ---------------------------------------------------------------------------
describe("isSparseDataEmpty", () => {
  it("returns true for empty object", () => {
    expect(isSparseDataEmpty({})).toBe(true);
  });

  it("returns false for non-empty data", () => {
    expect(isSparseDataEmpty({ "0": { "0": [0] } })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createEmptyMask
// ---------------------------------------------------------------------------
describe("createEmptyMask", () => {
  it("returns mask with empty data and given dimensions", () => {
    const mask = createEmptyMask(10, 20);
    expect(mask.data).toEqual({});
    expect(mask.width).toBe(10);
    expect(mask.height).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// addMaskAtPixel
// ---------------------------------------------------------------------------
describe("addMaskAtPixel", () => {
  it("adds a mask index at a new pixel", () => {
    const mask = createEmptyMask(10, 10);
    addMaskAtPixel(mask, 3, 5, 0);
    expect(mask.data["3"]["5"]).toEqual([0]);
  });

  it("does not duplicate the same index", () => {
    const mask = createEmptyMask(10, 10);
    addMaskAtPixel(mask, 3, 5, 0);
    addMaskAtPixel(mask, 3, 5, 0);
    expect(mask.data["3"]["5"]).toEqual([0]);
  });

  it("keeps indices sorted when adding multiple", () => {
    const mask = createEmptyMask(10, 10);
    addMaskAtPixel(mask, 0, 0, 2);
    addMaskAtPixel(mask, 0, 0, 1);
    expect(mask.data["0"]["0"]).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------------
// removeMaskAtPixel
// ---------------------------------------------------------------------------
describe("removeMaskAtPixel", () => {
  it("removes an existing mask index", () => {
    const mask = createEmptyMask(10, 10);
    addMaskAtPixel(mask, 1, 2, 0);
    removeMaskAtPixel(mask, 1, 2, 0);
    expect(mask.data["1"]).toBeUndefined();
  });

  it("cleans up empty row entries after removal", () => {
    const mask = createEmptyMask(10, 10);
    addMaskAtPixel(mask, 1, 2, 0);
    removeMaskAtPixel(mask, 1, 2, 0);
    expect(mask.data["1"]).toBeUndefined();
  });

  it("does not fail when pixel does not exist", () => {
    const mask = createEmptyMask(10, 10);
    expect(() => removeMaskAtPixel(mask, 99, 99, 0)).not.toThrow();
  });

  it("leaves remaining indices at the pixel", () => {
    const mask = createEmptyMask(10, 10);
    addMaskAtPixel(mask, 0, 0, 0);
    addMaskAtPixel(mask, 0, 0, 1);
    removeMaskAtPixel(mask, 0, 0, 0);
    expect(mask.data["0"]["0"]).toEqual([1]);
  });
});

// ---------------------------------------------------------------------------
// getMaskIndicesAtPixel
// ---------------------------------------------------------------------------
describe("getMaskIndicesAtPixel", () => {
  it("returns indices at existing pixel", () => {
    const mask = createEmptyMask(10, 10);
    addMaskAtPixel(mask, 2, 3, 1);
    expect(getMaskIndicesAtPixel(mask, 2, 3)).toEqual([1]);
  });

  it("returns empty array for non-existent pixel", () => {
    const mask = createEmptyMask(10, 10);
    expect(getMaskIndicesAtPixel(mask, 0, 0)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getBaseName
// ---------------------------------------------------------------------------
describe("getBaseName", () => {
  it("strips extension from simple filename", () => {
    expect(getBaseName("image.png")).toBe("image");
  });

  it("handles path with directories", () => {
    expect(getBaseName("/path/to/file.jpg")).toBe("file");
  });

  it("handles filename with no extension", () => {
    expect(getBaseName("filename")).toBe("filename");
  });
});

// ---------------------------------------------------------------------------
// getMaskImageBaseName
// ---------------------------------------------------------------------------
describe("getMaskImageBaseName", () => {
  it("strips the _XX suffix from mask filename", () => {
    expect(getMaskImageBaseName("image_00.feather")).toBe("image");
  });

  it("strips multi-digit suffix", () => {
    expect(getMaskImageBaseName("photo_123.feather")).toBe("photo");
  });

  it("returns baseName as-is if no _XX suffix", () => {
    expect(getMaskImageBaseName("image.feather")).toBe("image");
  });
});

// ---------------------------------------------------------------------------
// sparseMaskDataToRawBinary
// ---------------------------------------------------------------------------
describe("sparseMaskDataToRawBinary", () => {
  it("converts sparse data to flat binary array", () => {
    const data: SparseMaskData = { "0": { "0": [0] } };
    const result = sparseMaskDataToRawBinary(data, 2, 2, 0);
    expect(result[0]).toBe(1);
    expect(result[1]).toBe(0);
  });

  it("skips out-of-bounds rows/cols", () => {
    const data: SparseMaskData = { "5": { "0": [0] } }; // row out of bounds for height=2
    const result = sparseMaskDataToRawBinary(data, 2, 2, 0);
    expect(Array.from(result)).toEqual([0, 0, 0, 0]);
  });
});

// ---------------------------------------------------------------------------
// rawBinaryToSparseMask
// ---------------------------------------------------------------------------
describe("rawBinaryToSparseMask", () => {
  it("converts binary array to sparse mask", () => {
    const binary = new Uint8Array([1, 0, 0, 1]);
    const result = rawBinaryToSparseMask(binary, 2, 2);
    expect(result["0"]["0"]).toBe(1);
    expect(result["1"]["1"]).toBe(1);
    expect(result["0"]?.["1"]).toBeUndefined();
  });

  it("returns empty for all-zero binary", () => {
    const binary = new Uint8Array([0, 0, 0, 0]);
    const result = rawBinaryToSparseMask(binary, 2, 2);
    expect(Object.keys(result)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// serializeMaskForStorage
// ---------------------------------------------------------------------------
describe("serializeMaskForStorage", () => {
  it("returns data, width, height from parsed mask", () => {
    const parsed: ParsedMask = {
      baseName: "test",
      data: { "0": { "0": [0] } },
      width: 5,
      height: 5,
      maskIndex: 0,
    };
    const result = serializeMaskForStorage(parsed);
    expect(result.width).toBe(5);
    expect(result.height).toBe(5);
    expect(result.data).toEqual(parsed.data);
  });
});

// ---------------------------------------------------------------------------
// mergeMasksForStorage
// ---------------------------------------------------------------------------
describe("mergeMasksForStorage", () => {
  it("returns null for empty array", () => {
    expect(mergeMasksForStorage([])).toBeNull();
  });

  it("merges masks using first mask dimensions", () => {
    const a: ParsedMask = { baseName: "a", data: { "0": { "0": [0] } }, width: 4, height: 4, maskIndex: 0 };
    const b: ParsedMask = { baseName: "b", data: { "1": { "1": [1] } }, width: 4, height: 4, maskIndex: 1 };
    const result = mergeMasksForStorage([a, b]);
    expect(result).not.toBeNull();
    expect(result!.width).toBe(4);
    expect(result!.data["0"]["0"]).toEqual([0]);
    expect(result!.data["1"]["1"]).toEqual([1]);
  });
});

// ---------------------------------------------------------------------------
// prepareMaskFromParsed
// ---------------------------------------------------------------------------
describe("prepareMaskFromParsed", () => {
  it("returns doc with maskId, size, dimensions", () => {
    const parsed: ParsedMask = {
      baseName: "test",
      data: { "0": { "0": [0], "1": [0] } },
      width: 3,
      height: 3,
      maskIndex: 0,
    };
    const result = prepareMaskFromParsed("mask-001", parsed);
    expect(result.doc.maskId).toBe("mask-001");
    expect(result.doc.size).toBeGreaterThan(0);
    expect(result.doc.labelId).toBeNull();
    expect(result.binary).toBeInstanceOf(Buffer);
  });
});

// ---------------------------------------------------------------------------
// createMaskMapFromMasks
// ---------------------------------------------------------------------------
describe("createMaskMapFromMasks", () => {
  it("creates a mask map with all masks unlabeled", () => {
    const maskIds = ["mask-1", "mask-2"];
    const maskSizes = { "mask-1": 100, "mask-2": 200 };
    const result = createMaskMapFromMasks(
      "map-1", "img-1", maskIds, maskSizes, "/color", "/overlay", 10, 10
    );
    expect(result.maskLabels["mask-1"]).toBeNull();
    expect(result.maskLabels["mask-2"]).toBeNull();
    expect(result.colorMapStoragePath).toBe("/color");
    expect(result.maskOverlayStoragePath).toBe("/overlay");
  });
});

// ---------------------------------------------------------------------------
// generateMaskOverlay
// ---------------------------------------------------------------------------
describe("generateMaskOverlay", () => {
  it("returns an overlay with correct dimensions", () => {
    const masks = [
      { maskId: "m1", size: 4, binaryMask: { "0": { "0": 1 as 1, "1": 1 as 1 } } },
    ];
    const result = generateMaskOverlay(masks, 3, 2);
    expect(result.width).toBe(3);
    expect(result.height).toBe(2);
    expect(result.data).toHaveLength(6);
  });

  it("fills -1 for uncovered pixels", () => {
    const masks: Array<{ maskId: string; size: number; binaryMask: SparseBinaryMask }> = [];
    const result = generateMaskOverlay(masks, 2, 2);
    expect(result.data).toEqual([-1, -1, -1, -1]);
  });

  it("assigns mask index for covered pixels", () => {
    const binaryMask: SparseBinaryMask = { "0": { "0": 1 } };
    const masks = [{ maskId: "m1", size: 1, binaryMask }];
    const result = generateMaskOverlay(masks, 2, 2);
    expect(result.data[0]).toBe(0); // pixel at row=0, col=0 → index 0
    expect(result.data[1]).toBe(-1); // uncovered
  });

  it("picks the smaller mask for overlapping pixels", () => {
    const binaryMask: SparseBinaryMask = { "0": { "0": 1 } };
    const masks = [
      { maskId: "big", size: 100, binaryMask },
      { maskId: "small", size: 1, binaryMask },
    ];
    const result = generateMaskOverlay(masks, 2, 2);
    // "small" has index 1, "big" has index 0
    expect(result.data[0]).toBe(1); // smaller mask wins
  });

  it("handles empty dimensions", () => {
    const result = generateMaskOverlay([], 0, 0);
    expect(result.data).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// computeColorMap
// ---------------------------------------------------------------------------
describe("computeColorMap", () => {
  it("returns empty colorMap when no masks are labeled", () => {
    const result = computeColorMap(
      { "m1": null },
      [{ maskId: "m1", binaryMask: { "0": { "0": 1 } } }],
      {}
    );
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("assigns color from label to labeled mask pixels", () => {
    const result = computeColorMap(
      { "m1": "label-1" },
      [{ maskId: "m1", binaryMask: { "0": { "0": 1 } } }],
      { "label-1": { labelId: "label-1", name: "Cat", color: "#ff0000" } }
    );
    expect(result["0"]["0"]).toBe("#ff0000");
  });

  it("blends colors when two labeled masks overlap", () => {
    const binaryMask: SparseBinaryMask = { "0": { "0": 1 } };
    const result = computeColorMap(
      { "m1": "l1", "m2": "l2" },
      [
        { maskId: "m1", binaryMask },
        { maskId: "m2", binaryMask },
      ],
      {
        "l1": { labelId: "l1", name: "A", color: "#ff0000" },
        "l2": { labelId: "l2", name: "B", color: "#0000ff" },
      }
    );
    // Blended color should exist at the overlapping pixel
    expect(result["0"]["0"]).toBeDefined();
  });

  it("skips masks with unknown label ids", () => {
    const result = computeColorMap(
      { "m1": "nonexistent-label" },
      [{ maskId: "m1", binaryMask: { "0": { "0": 1 } } }],
      {}
    );
    expect(Object.keys(result)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// parseFeatherMask (mocked tableFromIPC)
// ---------------------------------------------------------------------------
describe("parseFeatherMask", () => {
  beforeEach(() => {
    vi.mocked(tableFromIPC).mockReset();
  });

  it("returns null when tableFromIPC throws", () => {
    vi.mocked(tableFromIPC).mockImplementation(() => {
      throw new Error("parse error");
    });
    const result = parseFeatherMask(Buffer.from([]), "test");
    expect(result).toBeNull();
  });

  it("returns null when no mask column is found", () => {
    vi.mocked(tableFromIPC).mockReturnValue({
      schema: { fields: [{ name: "irrelevant" }] },
      getChild: vi.fn().mockReturnValue(null),
      numRows: 0,
      numCols: 0,
    } as unknown as ReturnType<typeof tableFromIPC>);

    const result = parseFeatherMask(Buffer.from([]), "test");
    expect(result).toBeNull();
  });

  it("returns ParsedMask for a simple numeric array column", () => {
    // 4x4 square mask (16 pixels)
    const values = Array(16).fill(0).map((_, i) => (i < 4 ? 1 : 0));
    const colMock = {
      type: { typeId: 10, toString: () => "Int8" },
      get: vi.fn((i: number) => values[i]),
    };
    vi.mocked(tableFromIPC).mockReturnValue({
      schema: { fields: [{ name: "mask" }] },
      getChild: vi.fn((name: string) => (name === "mask" ? colMock : null)),
      numRows: 16,
      numCols: 1,
    } as unknown as ReturnType<typeof tableFromIPC>);

    const result = parseFeatherMask(Buffer.from([]), "test");
    expect(result).not.toBeNull();
    expect(result?.baseName).toBe("test");
    expect(result?.width).toBeGreaterThan(0);
    expect(result?.height).toBeGreaterThan(0);
  });

  it("uses explicit width and height when available", () => {
    // With explicit width/height columns and numCols=1, the mask is treated as
    // a single-column flattened array. Width/height are read first.
    const values = Array(4).fill(1);
    const maskCol = {
      type: { typeId: 10, toString: () => "Int8" },
      get: vi.fn((i: number) => values[i]),
    };
    const widthCol = { get: vi.fn(() => 2) };
    const heightCol = { get: vi.fn(() => 2) };

    vi.mocked(tableFromIPC).mockReturnValue({
      schema: { fields: [{ name: "mask" }, { name: "width" }, { name: "height" }] },
      getChild: vi.fn((name: string) => {
        if (name === "mask") return maskCol;
        if (name === "width") return widthCol;
        if (name === "height") return heightCol;
        return null;
      }),
      numRows: 4,
      numCols: 1, // treat as single-column so mask column is processed
    } as unknown as ReturnType<typeof tableFromIPC>);

    const result = parseFeatherMask(Buffer.from([]), "test");
    expect(result?.width).toBe(2);
    expect(result?.height).toBe(2);
  });

  it("accepts custom maskIndex argument", () => {
    const values = Array(4).fill(1);
    const maskCol = {
      type: { typeId: 10, toString: () => "Int8" },
      get: vi.fn((i: number) => values[i]),
    };

    vi.mocked(tableFromIPC).mockReturnValue({
      schema: { fields: [{ name: "mask" }] },
      getChild: vi.fn((name: string) => (name === "mask" ? maskCol : null)),
      numRows: 4,
      numCols: 1,
    } as unknown as ReturnType<typeof tableFromIPC>);

    const result = parseFeatherMask(Buffer.from([]), "test", 5);
    expect(result?.maskIndex).toBe(5);
  });
});
