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
  readBinMaskRaw,
  serializeMaskToBin,
  addMaskAtPixel,
  removeMaskAtPixel,
  getMaskIndicesAtPixel,
  createEmptyMask,
  generateMaskOverlay,
  rawBinaryToSparseMask,
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

  describe("readBinMaskRaw", () => {
    it("returns null for buffer too short", () => {
      assert.strictEqual(readBinMaskRaw(Buffer.alloc(4), "x", 0), null);
    });
    it("reads header and returns RawBinMask with correct fields", () => {
      const width = 2;
      const height = 2;
      const raw = Buffer.from([1, 0, 0, 1]);
      const bin = serializeMaskToBin(raw, width, height);
      const result = readBinMaskRaw(bin, "test", 1);
      assert.ok(result !== null);
      assert.strictEqual(result?.baseName, "test");
      assert.strictEqual(result?.width, width);
      assert.strictEqual(result?.height, height);
      assert.strictEqual(result?.maskIndex, 1);
      assert.strictEqual(result?.size, 2);
      assert.ok(Buffer.isBuffer(result?.binary));
      assert.strictEqual(result?.binary.length, width * height);
      assert.strictEqual(result?.binary[0], 1);
      assert.strictEqual(result?.binary[3], 1);
    });
    it("returns null for invalid size (header + body length mismatch)", () => {
      const bin = Buffer.alloc(8 + 10);
      bin.writeUInt32LE(2, 0);
      bin.writeUInt32LE(2, 4);
      assert.strictEqual(readBinMaskRaw(bin, "x", 0), null);
    });
    it("roundtrip: serializeMaskToBin -> readBinMaskRaw preserves dimensions and pixel count", () => {
      const width = 4;
      const height = 3;
      const raw = Buffer.alloc(width * height, 0);
      raw[0] = 1;
      raw[width * height - 1] = 1;
      const bin = serializeMaskToBin(raw, width, height);
      const result = readBinMaskRaw(bin, "img", 0);
      assert.ok(result !== null);
      assert.strictEqual(result?.width, width);
      assert.strictEqual(result?.height, height);
      assert.strictEqual(result?.size, 2);
      assert.strictEqual(result?.binary.length, width * height);
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

  describe("generateMaskOverlay", () => {
    it("returns data as a base64 string", () => {
      const binary = new Uint8Array([1, 0, 0, 1]); // 2x2: TL and BR set
      const binaryMask = rawBinaryToSparseMask(binary, 2, 2);
      const overlay = generateMaskOverlay(
        [{ maskId: "m1", size: 2, binaryMask, srcWidth: 2, srcHeight: 2 }],
        2,
        2
      );
      assert.strictEqual(typeof overlay.data, "string", "data must be a base64 string");
      assert.ok(overlay.data.length > 0, "base64 string must not be empty");
    });

    it("data decodes to an Int32Array with correct values", () => {
      const binary = new Uint8Array([1, 0, 0, 1]); // 2x2: TL=1, TR=0, BL=0, BR=1
      const binaryMask = rawBinaryToSparseMask(binary, 2, 2);
      const overlay = generateMaskOverlay(
        [{ maskId: "m1", size: 2, binaryMask, srcWidth: 2, srcHeight: 2 }],
        2,
        2
      );

      const buf = Buffer.from(overlay.data, "base64");
      const int32 = new Int32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);

      // TL pixel (0,0) → maskIndex 0
      assert.strictEqual(int32[0], 0, "TL pixel should be maskIndex 0");
      // TR pixel (0,1) → no mask (-1)
      assert.strictEqual(int32[1], -1, "TR pixel should be -1 (no mask)");
      // BL pixel (1,0) → no mask (-1)
      assert.strictEqual(int32[2], -1, "BL pixel should be -1 (no mask)");
      // BR pixel (1,1) → maskIndex 0
      assert.strictEqual(int32[3], 0, "BR pixel should be maskIndex 0");
    });

    it("returns maskIds in overlay matching input order", () => {
      const binary = new Uint8Array([1, 0, 0, 0]);
      const binaryMask = rawBinaryToSparseMask(binary, 2, 2);
      const overlay = generateMaskOverlay(
        [{ maskId: "abc", size: 1, binaryMask, srcWidth: 2, srcHeight: 2 }],
        2,
        2
      );
      assert.deepStrictEqual(overlay.maskIds, ["abc"]);
    });

    it("smallest mask wins when two masks overlap", () => {
      // 2x2 grid: both masks cover all 4 pixels; smaller mask (size=2) should win
      const fullBinary = new Uint8Array([1, 1, 1, 1]);
      const fullMask = rawBinaryToSparseMask(fullBinary, 2, 2);
      const overlay = generateMaskOverlay(
        [
          { maskId: "big", size: 4, binaryMask: fullMask, srcWidth: 2, srcHeight: 2 },
          { maskId: "small", size: 2, binaryMask: fullMask, srcWidth: 2, srcHeight: 2 },
        ],
        2,
        2
      );
      const buf = Buffer.from(overlay.data, "base64");
      const int32 = new Int32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
      // "small" is index 1 — should win at every pixel
      for (let i = 0; i < 4; i++) {
        assert.strictEqual(int32[i], 1, `pixel ${i} should be maskIndex 1 (small)`);
      }
    });

    it("empty masks array returns all -1", () => {
      const overlay = generateMaskOverlay([], 2, 2);
      const buf = Buffer.from(overlay.data, "base64");
      const int32 = new Int32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
      for (let i = 0; i < 4; i++) {
        assert.strictEqual(int32[i], -1);
      }
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
