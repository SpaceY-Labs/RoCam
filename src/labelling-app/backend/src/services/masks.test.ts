import { describe, it } from "node:test";
import assert from "node:assert";
import { tableFromIPC } from "apache-arrow";
import {
  getBaseName,
  getMaskImageBaseName,
  binaryMaskToSparse,
  sparseToBinaryMask,
  mergeSparseData,
  getMaskIndices,
  isSparseDataEmpty,
  serializeMaskToFeather,
  parseBinMask,
  serializeMaskToBin,
  addMaskAtPixel,
  removeMaskAtPixel,
  getMaskIndicesAtPixel,
  createEmptyMask,
} from "./masks";

describe("masks", () => {
  describe("getBaseName", () => {
    it("strips extension from filename", () => {
      assert.strictEqual(getBaseName("photo.png"), "photo");
      assert.strictEqual(getBaseName("image.jpg"), "image");
      assert.strictEqual(getBaseName("file.webp"), "file");
    });
    it("handles path and returns basename without extension", () => {
      assert.strictEqual(getBaseName("folder/photo.png"), "photo");
      assert.strictEqual(getBaseName("a/b/c.x"), "c");
    });
    it("returns full string when no extension", () => {
      assert.strictEqual(getBaseName("noext"), "noext");
    });
  });

  describe("getMaskImageBaseName", () => {
    it("strips _XX suffix and extension from mask filename", () => {
      assert.strictEqual(getMaskImageBaseName("image_00.feather"), "image");
      assert.strictEqual(getMaskImageBaseName("photo_01.feather"), "photo");
      assert.strictEqual(getMaskImageBaseName("x_99.arrow"), "x");
    });
    it("returns baseName when no _XX suffix", () => {
      assert.strictEqual(getMaskImageBaseName("image.feather"), "image");
      assert.strictEqual(getMaskImageBaseName("single.arrow"), "single");
    });
  });

  describe("binaryMaskToSparse", () => {
    it("converts binary mask to sparse row/col map for maskIndex", () => {
      const mask = new Uint8Array(4); // 2x2
      mask[0] = 1;
      mask[3] = 1;
      const data = binaryMaskToSparse(mask, 2, 2, 0);
      assert.deepStrictEqual(data["0"]?.["0"], [0]);
      assert.deepStrictEqual(data["1"]?.["1"], [0]);
      assert.strictEqual(Object.keys(data).length, 2);
    });
    it("returns empty object for all-zero mask", () => {
      const mask = new Uint8Array(9);
      const data = binaryMaskToSparse(mask, 3, 3, 1);
      assert.strictEqual(Object.keys(data).length, 0);
    });
  });

  describe("sparseToBinaryMask", () => {
    it("converts sparse data back to binary for given maskIndex", () => {
      const data: Record<string, Record<string, number[]>> = {
        "0": { "0": [0], "1": [1] },
        "1": { "0": [1] },
      };
      const mask = sparseToBinaryMask(data, 2, 2, 0);
      assert.strictEqual(mask[0], 1);
      assert.strictEqual(mask[1], 0);
      assert.strictEqual(mask[2], 0);
      assert.strictEqual(mask[3], 0);
      const mask1 = sparseToBinaryMask(data, 2, 2, 1);
      assert.strictEqual(mask1[1], 1);
      assert.strictEqual(mask1[2], 1);
    });
  });

  describe("mergeSparseData", () => {
    it("merges multiple sparse maps and combines indices at same pixel", () => {
      const a: Record<string, Record<string, number[]>> = { "0": { "0": [0] } };
      const b: Record<string, Record<string, number[]>> = { "0": { "0": [1] } };
      const merged = mergeSparseData([a, b]);
      assert.deepStrictEqual(merged["0"]?.["0"], [0, 1]);
    });
    it("returns empty for empty array", () => {
      const merged = mergeSparseData([]);
      assert.strictEqual(Object.keys(merged).length, 0);
    });
  });

  describe("getMaskIndices", () => {
    it("returns sorted unique mask indices from sparse data", () => {
      const data: Record<string, Record<string, number[]>> = {
        "0": { "0": [2, 0], "1": [1] },
      };
      assert.deepStrictEqual(getMaskIndices(data), [0, 1, 2]);
    });
  });

  describe("isSparseDataEmpty", () => {
    it("returns true for empty object", () => {
      assert.strictEqual(isSparseDataEmpty({}), true);
    });
    it("returns false when any keys exist", () => {
      assert.strictEqual(isSparseDataEmpty({ "0": {} }), false);
    });
  });

  describe("serializeMaskToFeather", () => {
    it("produces valid Arrow IPC with width/height columns", () => {
      const width = 4;
      const height = 3;
      const raw = new Uint8Array(width * height);
      raw[0] = 1;
      raw[width * height - 1] = 1;
      const buffer = Buffer.from(raw);
      const feather = serializeMaskToFeather(buffer, width, height);
      assert.ok(feather.length > 0);
      const table = tableFromIPC(feather);
      assert.strictEqual(table.numRows, 1);
      const widthCol = table.getChild("width");
      const heightCol = table.getChild("height");
      assert.ok(widthCol !== null);
      assert.ok(heightCol !== null);
      assert.strictEqual(Number(widthCol?.get(0)), width);
      assert.strictEqual(Number(heightCol?.get(0)), height);
    });
  });

  describe("serializeMaskToBin / parseBinMask", () => {
    it("serializeMaskToBin produces 8-byte header + raw bytes", () => {
      const width = 4;
      const height = 3;
      const raw = Buffer.alloc(width * height, 0);
      raw[0] = 1;
      raw[raw.length - 1] = 1;
      const bin = serializeMaskToBin(raw, width, height);
      assert.strictEqual(bin.length, 8 + width * height);
      assert.strictEqual(bin.readUInt32LE(0), width);
      assert.strictEqual(bin.readUInt32LE(4), height);
      assert.strictEqual(bin[8], 1);
      assert.strictEqual(bin[bin.length - 1], 1);
    });
    it("parseBinMask reads header and returns ParsedMask", () => {
      const width = 2;
      const height = 2;
      const raw = new Uint8Array([1, 0, 0, 1]);
      const bin = serializeMaskToBin(Buffer.from(raw), width, height);
      const parsed = parseBinMask(bin, "test", 0);
      assert.ok(parsed !== null);
      assert.strictEqual(parsed?.baseName, "test");
      assert.strictEqual(parsed?.width, width);
      assert.strictEqual(parsed?.height, height);
      assert.strictEqual(parsed?.maskIndex, 0);
      assert.deepStrictEqual(parsed?.data["0"]?.["0"], [0]);
      assert.deepStrictEqual(parsed?.data["1"]?.["1"], [0]);
    });
    it("parseBinMask returns null for buffer too short", () => {
      assert.strictEqual(parseBinMask(Buffer.alloc(4), "x", 0), null);
    });
    it("roundtrip: raw -> serializeMaskToBin -> parseBinMask -> sparse matches binaryMaskToSparse", () => {
      const width = 3;
      const height = 2;
      const raw = new Uint8Array(width * height);
      raw[1] = 1;
      raw[4] = 1;
      const bin = serializeMaskToBin(Buffer.from(raw), width, height);
      const parsed = parseBinMask(bin, "img", 1);
      assert.ok(parsed !== null);
      const expected = binaryMaskToSparse(raw, width, height, 1);
      assert.deepStrictEqual(parsed?.data, expected);
    });
  });

  describe("createEmptyMask", () => {
    it("returns serialized mask with empty data and given dimensions", () => {
      const m = createEmptyMask(10, 20);
      assert.strictEqual(m.width, 10);
      assert.strictEqual(m.height, 20);
      assert.strictEqual(Object.keys(m.data).length, 0);
    });
  });

  describe("addMaskAtPixel / getMaskIndicesAtPixel / removeMaskAtPixel", () => {
    it("adds and reads mask index at pixel", () => {
      const mask = createEmptyMask(2, 2);
      addMaskAtPixel(mask, 0, 0, 0);
      addMaskAtPixel(mask, 0, 0, 1);
      assert.deepStrictEqual(getMaskIndicesAtPixel(mask, 0, 0), [0, 1]);
      assert.deepStrictEqual(getMaskIndicesAtPixel(mask, 1, 1), []);
    });
    it("removeMaskAtPixel removes index and cleans empty entries", () => {
      const mask = createEmptyMask(2, 2);
      addMaskAtPixel(mask, 0, 0, 0);
      removeMaskAtPixel(mask, 0, 0, 0);
      assert.deepStrictEqual(getMaskIndicesAtPixel(mask, 0, 0), []);
      assert.strictEqual(Object.keys(mask.data).length, 0);
    });
  });
});
