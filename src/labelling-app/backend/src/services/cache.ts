/**
 * Author: Jianqing Liu
 * Date: 2026-01-27
 * Purpose: LRU cache factory with TTL and configurable size limits for mask and image data.
 */
import { config } from "../config";

const MB = 1024 * 1024;

type SizeEstimator<T> = (value: T) => number;

type CacheEntry<T> = {
  value: T;
  size: number;
  expiresAt: number;
};

export interface LruCache<T> {
  get: (key: string) => T | undefined;
  set: (key: string, value: T, sizeOverride?: number) => void;
  delete: (key: string) => void;
  clear: () => void;
  sizeBytes: () => number;
  entries: () => number;
}

const createNoopCache = <T>(): LruCache<T> => ({
  get: () => undefined,
  set: () => {},
  delete: () => {},
  clear: () => {},
  sizeBytes: () => 0,
  entries: () => 0,
});

const toBytes = (mb: number) => Math.max(0, mb) * MB;

export const createLruCache = <T>(options: {
  maxBytes: number;
  ttlMs: number;
  estimateSize: SizeEstimator<T>;
}): LruCache<T> => {
  if (options.maxBytes <= 0) {
    return createNoopCache<T>();
  }

  const maxBytes = options.maxBytes;
  const ttlMs = options.ttlMs;
  const estimateSize = options.estimateSize;
  const entries = new Map<string, CacheEntry<T>>();
  let currentBytes = 0;

  const evictIfNeeded = () => {
    while (currentBytes > maxBytes && entries.size > 0) {
      const oldestKey = entries.keys().next().value as string | undefined;
      if (!oldestKey) {
        break;
      }
      const oldestEntry = entries.get(oldestKey);
      if (oldestEntry) {
        currentBytes -= oldestEntry.size;
      }
      entries.delete(oldestKey);
    }
  };

  const isExpired = (entry: CacheEntry<T>, now: number) =>
    Number.isFinite(entry.expiresAt) && entry.expiresAt <= now;

  return {
    get(key: string) {
      const entry = entries.get(key);
      if (!entry) {
        return undefined;
      }
      const now = Date.now();
      if (isExpired(entry, now)) {
        entries.delete(key);
        currentBytes -= entry.size;
        return undefined;
      }
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set(key: string, value: T, sizeOverride?: number) {
      const entrySize =
        typeof sizeOverride === "number" && Number.isFinite(sizeOverride)
          ? sizeOverride
          : estimateSize(value);
      if (!Number.isFinite(entrySize) || entrySize <= 0) {
        return;
      }
      if (entrySize > maxBytes) {
        return;
      }
      const expiresAt = ttlMs > 0 ? Date.now() + ttlMs : Number.POSITIVE_INFINITY;
      const existing = entries.get(key);
      if (existing) {
        currentBytes -= existing.size;
        entries.delete(key);
      }
      entries.set(key, { value, size: entrySize, expiresAt });
      currentBytes += entrySize;
      evictIfNeeded();
    },
    delete(key: string) {
      const entry = entries.get(key);
      if (entry) {
        currentBytes -= entry.size;
      }
      entries.delete(key);
    },
    clear() {
      entries.clear();
      currentBytes = 0;
    },
    sizeBytes() {
      return currentBytes;
    },
    entries() {
      return entries.size;
    },
  };
};

export const estimateColorMapSize = (
  colorMap: Record<string, Record<string, string>>
): number => {
  let bytes = 2;
  for (const [rowKey, cols] of Object.entries(colorMap)) {
    bytes += rowKey.length + 4;
    for (const [colKey, color] of Object.entries(cols)) {
      bytes += colKey.length + color.length + 6;
    }
  }
  return bytes;
};

export const estimateMaskOverlaySize = (overlay: {
  data: number[];
  maskIds: string[];
} | null): number => {
  if (!overlay) {
    return 0;
  }
  let idsBytes = 0;
  for (const id of overlay.maskIds || []) {
    idsBytes += id.length;
  }
  return overlay.data.length * 4 + idsBytes + 64;
};

export const estimateBufferSize = (buffer: Buffer): number =>
  buffer?.byteLength ?? 0;

export const colorMapCache = createLruCache<Record<string, Record<string, string>>>({
  maxBytes: toBytes(config.cacheColorMapMb),
  ttlMs: config.cacheColorMapTtlMs,
  estimateSize: estimateColorMapSize,
});

export const maskOverlayCache = createLruCache<{
  width: number;
  height: number;
  maskIds: string[];
  data: number[];
}>({
  maxBytes: toBytes(config.cacheMaskOverlayMb),
  ttlMs: config.cacheMaskOverlayTtlMs,
  estimateSize: estimateMaskOverlaySize,
});

export const maskBufferCache = createLruCache<Buffer>({
  maxBytes: toBytes(config.cacheMaskBinaryMb),
  ttlMs: config.cacheMaskBinaryTtlMs,
  estimateSize: estimateBufferSize,
});
