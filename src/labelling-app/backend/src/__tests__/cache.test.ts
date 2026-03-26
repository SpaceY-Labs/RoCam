import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createLruCache,
  estimateColorMapSize,
  estimateMaskOverlaySize,
  estimateBufferSize,
} from "../services/cache";

// Suppress config-level dotenv warnings by stubbing the module
vi.mock("../config", () => ({
  config: {
    cacheColorMapMb: 32,
    cacheMaskOverlayMb: 64,
    cacheMaskBinaryMb: 64,
    cacheColorMapTtlMs: 300000,
    cacheMaskOverlayTtlMs: 300000,
    cacheMaskBinaryTtlMs: 300000,
  },
}));

// ============================================================================
// estimateColorMapSize
// ============================================================================
describe("estimateColorMapSize", () => {
  it("returns 2 for an empty color map", () => {
    expect(estimateColorMapSize({})).toBe(2);
  });

  it("calculates bytes for a single cell", () => {
    const colorMap = { "0": { "0": "#FF0000" } };
    // rowKey="0" (1) + 4 + colKey="0" (1) + color="#FF0000" (7) + 6 = 19 + 2 = 21
    const size = estimateColorMapSize(colorMap);
    expect(size).toBeGreaterThan(2);
    expect(typeof size).toBe("number");
  });

  it("accumulates bytes for multiple cells", () => {
    const small = estimateColorMapSize({ "0": { "0": "#F00" } });
    const large = estimateColorMapSize({
      "0": { "0": "#F00", "1": "#0F0" },
      "1": { "0": "#00F" },
    });
    expect(large).toBeGreaterThan(small);
  });
});

// ============================================================================
// estimateMaskOverlaySize
// ============================================================================
describe("estimateMaskOverlaySize", () => {
  it("returns 0 for null", () => {
    expect(estimateMaskOverlaySize(null)).toBe(0);
  });

  it("calculates size based on data length and maskIds", () => {
    const overlay = { data: [1, 2, 3, 4], maskIds: ["mask-a", "mask-b"] };
    const size = estimateMaskOverlaySize(overlay);
    // data.length * 4 + idBytes + 64
    const expectedMin = 4 * 4 + 12 + 64;
    expect(size).toBe(expectedMin);
  });

  it("handles empty data and maskIds", () => {
    const overlay = { data: [], maskIds: [] };
    expect(estimateMaskOverlaySize(overlay)).toBe(64);
  });
});

// ============================================================================
// estimateBufferSize
// ============================================================================
describe("estimateBufferSize", () => {
  it("returns buffer byte length", () => {
    const buf = Buffer.from("hello");
    expect(estimateBufferSize(buf)).toBe(5);
  });

  it("returns 0 for empty buffer", () => {
    expect(estimateBufferSize(Buffer.alloc(0))).toBe(0);
  });
});

// ============================================================================
// createLruCache – noop when maxBytes <= 0
// ============================================================================
describe("createLruCache – noop cache", () => {
  it("returns undefined on get when maxBytes is 0", () => {
    const cache = createLruCache<string>({
      maxBytes: 0,
      ttlMs: 60000,
      estimateSize: (v) => v.length,
    });
    cache.set("key", "value");
    expect(cache.get("key")).toBeUndefined();
    expect(cache.sizeBytes()).toBe(0);
    expect(cache.entries()).toBe(0);
  });
});

// ============================================================================
// createLruCache – functional cache
// ============================================================================
describe("createLruCache – functional", () => {
  const makeCache = (maxBytes = 1000, ttlMs = 60000) =>
    createLruCache<string>({
      maxBytes,
      ttlMs,
      estimateSize: (v) => v.length,
    });

  it("stores and retrieves a value", () => {
    const cache = makeCache();
    cache.set("k1", "hello");
    expect(cache.get("k1")).toBe("hello");
  });

  it("returns undefined for missing key", () => {
    const cache = makeCache();
    expect(cache.get("missing")).toBeUndefined();
  });

  it("tracks size after set and delete", () => {
    const cache = makeCache();
    cache.set("k1", "abc"); // 3 bytes
    expect(cache.sizeBytes()).toBe(3);
    cache.delete("k1");
    expect(cache.sizeBytes()).toBe(0);
    expect(cache.entries()).toBe(0);
  });

  it("overwrites an existing key", () => {
    const cache = makeCache();
    cache.set("k1", "abc");
    cache.set("k1", "xy");
    expect(cache.get("k1")).toBe("xy");
    expect(cache.sizeBytes()).toBe(2);
  });

  it("clears all entries", () => {
    const cache = makeCache();
    cache.set("k1", "abc");
    cache.set("k2", "de");
    cache.clear();
    expect(cache.sizeBytes()).toBe(0);
    expect(cache.entries()).toBe(0);
  });

  it("evicts the oldest entry when over capacity", () => {
    const cache = makeCache(5); // max 5 bytes
    cache.set("k1", "abc"); // 3 bytes
    cache.set("k2", "de");  // 2 bytes  → 5 total
    cache.set("k3", "x");  // 1 byte → evict k1 (oldest)
    expect(cache.get("k1")).toBeUndefined();
    expect(cache.get("k2")).toBe("de");
    expect(cache.get("k3")).toBe("x");
  });

  it("ignores entries larger than maxBytes", () => {
    const cache = makeCache(3);
    cache.set("big", "hello world"); // 11 bytes > 3
    expect(cache.get("big")).toBeUndefined();
    expect(cache.sizeBytes()).toBe(0);
  });

  it("ignores entries with non-positive estimated size", () => {
    const cache = createLruCache<string>({
      maxBytes: 100,
      ttlMs: 60000,
      estimateSize: () => -1,
    });
    cache.set("k", "val");
    expect(cache.get("k")).toBeUndefined();
  });

  it("returns undefined for expired entries", () => {
    const cache = makeCache(1000, 1); // 1ms TTL
    cache.set("k1", "hello");
    // Advance time by 100ms
    vi.useFakeTimers();
    vi.advanceTimersByTime(100);
    const result = cache.get("k1");
    vi.useRealTimers();
    expect(result).toBeUndefined();
  });

  it("uses sizeOverride when provided", () => {
    const cache = makeCache(1000);
    cache.set("k1", "abc", 10); // override size to 10
    expect(cache.sizeBytes()).toBe(10);
  });

  it("respects LRU order: recently accessed key survives eviction", () => {
    const cache = makeCache(5);
    cache.set("k1", "abc"); // 3 bytes
    cache.set("k2", "de");  // 2 bytes → 5 total
    // Access k1 to make it most recently used
    cache.get("k1");
    // Adding k3 should evict k2 (least recently used)
    cache.set("k3", "x"); // 1 byte → evict k2
    expect(cache.get("k1")).toBe("abc");
    expect(cache.get("k2")).toBeUndefined();
  });
});
