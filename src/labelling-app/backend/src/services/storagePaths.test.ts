import { describe, it } from "node:test";
import assert from "node:assert";
import {
  buildMaskStoragePath,
  buildColorMapStoragePath,
  buildMaskOverlayStoragePath,
} from "./storagePaths";

describe("storagePaths", () => {
  describe("buildMaskStoragePath", () => {
    it("returns path projects/{projectId}/images/{imageId}/masks/{maskId}.bin", () => {
      assert.strictEqual(
        buildMaskStoragePath("proj1", "img1", "mask1"),
        "projects/proj1/images/img1/masks/mask1.bin"
      );
      assert.strictEqual(
        buildMaskStoragePath("p", "i", "m"),
        "projects/p/images/i/masks/m.bin"
      );
    });
  });

  describe("buildColorMapStoragePath", () => {
    it("returns path projects/{projectId}/maskmaps/{maskMapId}/colormap.json", () => {
      assert.strictEqual(
        buildColorMapStoragePath("proj1", "map1"),
        "projects/proj1/maskmaps/map1/colormap.json"
      );
    });
  });

  describe("buildMaskOverlayStoragePath", () => {
    it("returns path projects/{projectId}/maskmaps/{maskMapId}/maskoverlay.json", () => {
      assert.strictEqual(
        buildMaskOverlayStoragePath("proj1", "map1"),
        "projects/proj1/maskmaps/map1/maskoverlay.json"
      );
    });
  });
});
