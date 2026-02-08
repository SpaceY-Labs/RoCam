import { tableFromArrays, tableFromIPC, tableToIPC } from "apache-arrow";

/**
 * Sparse 2D mask data: { rowIndex: { colIndex: maskIndices[] } }
 * Only non-empty pixels are stored.
 */
export type SparseMaskData = Record<string, Record<string, number[]>>;

/**
 * Mask data structure after parsing from Feather format
 */
export interface ParsedMask {
  /** Original filename (without extension) used to match with image */
  baseName: string;
  /** Sparse 2D mask data */
  data: SparseMaskData;
  /** Original mask dimensions */
  width: number;
  height: number;
  /** Mask index (when multiple masks exist for same image) */
  maskIndex: number;
}

/**
 * Serialized mask stored in Firestore
 */
export interface SerializedMask {
  /** Sparse 2D map: { rowIndex: { colIndex: maskIndices[] } } */
  data: SparseMaskData;
  /** Mask dimensions */
  width: number;
  height: number;
}

/**
 * Convert a binary mask array to sparse 2D map format for a specific mask index.
 * @param mask - Binary mask array (0 or 1 values)
 * @param width - Mask width
 * @param height - Mask height
 * @param maskIndex - Index to assign to positive pixels
 * @returns Sparse 2D map data
 */
export const binaryMaskToSparse = (
  mask: Uint8Array,
  width: number,
  height: number,
  maskIndex: number
): SparseMaskData => {
  const data: SparseMaskData = {};

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const idx = row * width + col;
      if (mask[idx] > 0) {
        const rowKey = String(row);
        const colKey = String(col);
        if (!data[rowKey]) {
          data[rowKey] = {};
        }
        data[rowKey][colKey] = [maskIndex];
      }
    }
  }

  return data;
};

/**
 * Merge multiple sparse mask data into one.
 * Combines mask indices for overlapping pixels.
 * @param masks - Array of sparse mask data to merge
 * @returns Merged sparse mask data
 */
export const mergeSparseData = (masks: SparseMaskData[]): SparseMaskData => {
  const merged: SparseMaskData = {};

  for (const mask of masks) {
    for (const [rowKey, cols] of Object.entries(mask)) {
      if (!merged[rowKey]) {
        merged[rowKey] = {};
      }
      for (const [colKey, indices] of Object.entries(cols)) {
        if (!merged[rowKey][colKey]) {
          merged[rowKey][colKey] = [];
        }
        // Add indices that aren't already present
        for (const idx of indices) {
          if (!merged[rowKey][colKey].includes(idx)) {
            merged[rowKey][colKey].push(idx);
          }
        }
        // Keep sorted for consistency
        merged[rowKey][colKey].sort((a, b) => a - b);
      }
    }
  }

  return merged;
};

/**
 * Convert sparse 2D map back to binary mask array for a specific mask index.
 * @param data - Sparse 2D mask data
 * @param width - Mask width
 * @param height - Mask height
 * @param maskIndex - Which mask index to extract
 * @returns Binary mask array (Uint8Array)
 */
export const sparseToBinaryMask = (
  data: SparseMaskData,
  width: number,
  height: number,
  maskIndex: number
): Uint8Array => {
  const mask = new Uint8Array(width * height);

  for (const [rowKey, cols] of Object.entries(data)) {
    const row = parseInt(rowKey, 10);
    if (row < 0 || row >= height) continue;

    for (const [colKey, indices] of Object.entries(cols)) {
      const col = parseInt(colKey, 10);
      if (col < 0 || col >= width) continue;

      if (indices.includes(maskIndex)) {
        mask[row * width + col] = 1;
      }
    }
  }

  return mask;
};

/**
 * Get all unique mask indices present in sparse data.
 * @param data - Sparse 2D mask data
 * @returns Array of unique mask indices, sorted
 */
export const getMaskIndices = (data: SparseMaskData): number[] => {
  const indices = new Set<number>();

  for (const cols of Object.values(data)) {
    for (const maskIndices of Object.values(cols)) {
      for (const idx of maskIndices) {
        indices.add(idx);
      }
    }
  }

  return Array.from(indices).sort((a, b) => a - b);
};

/**
 * Check if sparse data is empty (no masks).
 * @param data - Sparse 2D mask data
 * @returns True if empty
 */
export const isSparseDataEmpty = (data: SparseMaskData): boolean => {
  return Object.keys(data).length === 0;
};

/**
 * Parse a Feather file containing mask data.
 * Expected columns: mask (binary array), width, height
 * Or: a 2D boolean/int array flattened
 */
export const parseFeatherMask = (
  buffer: Buffer,
  baseName: string,
  maskIndex: number = 0
): ParsedMask | null => {
  try {
    const table = tableFromIPC(buffer);

    // Try to find mask data in the table
    const columnNames = table.schema.fields.map((f: { name: string }) => f.name);
    console.log(`[parseFeatherMask] Parsing ${baseName}, columns: ${columnNames.join(", ")}`);

    let maskData: Uint8Array | null = null;
    let width = 0;
    let height = 0;

    // Check for explicit width/height columns
    if (columnNames.includes("width") && columnNames.includes("height")) {
      const widthCol = table.getChild("width");
      const heightCol = table.getChild("height");
      if (widthCol && heightCol) {
        width = Number(widthCol.get(0));
        height = Number(heightCol.get(0));
        console.log(`[parseFeatherMask] ${baseName} dimensions: ${width}x${height}`);
      }
    }

    // Look for mask column (could be named 'mask', 'data', or first binary column)
    const maskColName =
      columnNames.find(
        (name: string) => name === "mask" || name === "data" || name === "values"
      ) || columnNames[0];

    const maskCol = table.getChild(maskColName);
    if (maskCol) {
      // Log type information for debugging
      const typeInfo = maskCol.type;
      console.log(`[parseFeatherMask] ${baseName} mask column type:`, {
        typeId: typeInfo.typeId,
        toString: String(typeInfo),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        typeName: (typeInfo as any).name || (typeInfo as any).constructor?.name,
      });

      // Check for binary type - apache-arrow uses different type IDs
      // Binary = 4, LargeBinary = 5 in apache-arrow JS
      // Also check type name as string for robustness
      const isBinaryType =
        typeInfo.typeId === 4 ||
        typeInfo.typeId === 5 ||
        typeInfo.typeId === 6 ||
        String(typeInfo).toLowerCase().includes("binary");

      if (isBinaryType) {
        console.log(`[parseFeatherMask] ${baseName} detected as binary type`);
        const binaryData = maskCol.get(0);
        if (binaryData) {
          // Handle different binary data representations
          if (binaryData instanceof Uint8Array) {
            maskData = binaryData;
          } else if (ArrayBuffer.isView(binaryData)) {
            maskData = new Uint8Array(binaryData.buffer, binaryData.byteOffset, binaryData.byteLength);
          } else if (binaryData instanceof ArrayBuffer) {
            maskData = new Uint8Array(binaryData);
          } else if (typeof binaryData === "object" && binaryData !== null) {
            // Some arrow implementations return a buffer-like object
            maskData = new Uint8Array(binaryData);
          }
          console.log(`[parseFeatherMask] ${baseName} binary data length: ${maskData?.length || 0}`);
        }
      } else {
        console.log(`[parseFeatherMask] ${baseName} trying as numeric array`);
        // Try to read as numeric array
        const numRows = table.numRows;
        const numCols = table.numCols;

        // If it's a single column with multiple rows, treat as flattened mask
        if (numCols === 1 || (numCols <= 3 && !width)) {
          const values: number[] = [];
          for (let i = 0; i < numRows; i++) {
            const val = maskCol.get(i);
            if (val !== null && val !== undefined) {
              values.push(Number(val) > 0 ? 1 : 0);
            }
          }
          maskData = new Uint8Array(values);

          // If no explicit dimensions, assume square
          if (!width || !height) {
            const size = Math.sqrt(values.length);
            if (Number.isInteger(size)) {
              width = size;
              height = size;
            } else {
              // Try common aspect ratios
              height = Math.round(Math.sqrt(values.length * 0.75));
              width = Math.floor(values.length / height);
            }
          }
        }
      }
    } else {
      console.warn(`[parseFeatherMask] ${baseName} no mask column found`);
    }

    // If we still don't have dimensions, try to infer from data
    if (maskData && (!width || !height)) {
      // Default to square if we can
      const size = Math.sqrt(maskData.length);
      if (Number.isInteger(size)) {
        width = size;
        height = size;
      } else {
        // Common image dimensions
        const commonHeights = [1080, 720, 480, 256, 128];
        for (const h of commonHeights) {
          if (maskData.length % h === 0) {
            height = h;
            width = maskData.length / h;
            break;
          }
        }
      }
    }

    if (!maskData || !width || !height) {
      console.warn(`[parseFeatherMask] Could not parse mask from feather file: ${baseName}, maskData: ${!!maskData}, width: ${width}, height: ${height}`);
      return null;
    }

    // Convert binary mask to sparse format
    const data = binaryMaskToSparse(maskData, width, height, maskIndex);
    const pixelCount = Object.values(data).reduce((sum, cols) => sum + Object.keys(cols).length, 0);
    console.log(`[parseFeatherMask] ${baseName} parsed successfully: ${width}x${height}, ${pixelCount} mask pixels`);

    return {
      baseName,
      data,
      width,
      height,
      maskIndex,
    };
  } catch (error) {
    console.error(`Error parsing feather mask ${baseName}:`, error);
    return null;
  }
};

/**
 * Serialize a mask (raw binary + dimensions) to Feather format for ZIP export.
 * Produces the same layout as upload: columns "mask" (binary), "width", "height" (int32).
 */
export const serializeMaskToFeather = (
  buffer: Buffer,
  width: number,
  height: number
): Buffer => {
  const table = tableFromArrays({
    mask: [new Uint8Array(buffer)],
    width: [width],
    height: [height],
  });
  const ipc = tableToIPC(table, "file");
  return Buffer.from(ipc);
};

/** Header size for .bin mask format: 4 bytes width + 4 bytes height (uint32 LE each). */
const BIN_MASK_HEADER_SIZE = 8;

/**
 * Parse a .bin mask buffer (8-byte header: width uint32 LE, height uint32 LE, then raw mask bytes).
 * Returns ParsedMask or null if invalid.
 */
export const parseBinMask = (
  buffer: Buffer,
  baseName: string,
  maskIndex: number = 0
): ParsedMask | null => {
  if (buffer.length < BIN_MASK_HEADER_SIZE) {
    return null;
  }
  const width = buffer.readUInt32LE(0);
  const height = buffer.readUInt32LE(4);
  const expectedSize = width * height;
  if (buffer.length !== BIN_MASK_HEADER_SIZE + expectedSize || width === 0 || height === 0) {
    return null;
  }
  const maskData = new Uint8Array(buffer.subarray(BIN_MASK_HEADER_SIZE));
  const data = binaryMaskToSparse(maskData, width, height, maskIndex);
  return {
    baseName,
    data,
    width,
    height,
    maskIndex,
  };
};

/**
 * Serialize a mask to .bin format for ZIP export: 8-byte header (width, height uint32 LE) + raw mask bytes.
 */
export const serializeMaskToBin = (
  buffer: Buffer,
  width: number,
  height: number
): Buffer => {
  const out = Buffer.allocUnsafe(BIN_MASK_HEADER_SIZE + buffer.length);
  out.writeUInt32LE(width, 0);
  out.writeUInt32LE(height, 4);
  buffer.copy(out, BIN_MASK_HEADER_SIZE, 0, buffer.length);
  return out;
};

/**
 * Serialize mask for storage in Firestore.
 */
export const serializeMaskForStorage = (mask: ParsedMask): SerializedMask => {
  return {
    data: mask.data,
    width: mask.width,
    height: mask.height,
  };
};

/**
 * Merge multiple ParsedMasks into a single SerializedMask.
 * Use this when an image has multiple mask files.
 */
export const mergeMasksForStorage = (masks: ParsedMask[]): SerializedMask | null => {
  if (masks.length === 0) return null;

  // Use dimensions from first mask
  const { width, height } = masks[0];

  // Merge all sparse data
  const mergedData = mergeSparseData(masks.map((m) => m.data));

  return {
    data: mergedData,
    width,
    height,
  };
};

/**
 * Create an empty serialized mask.
 */
export const createEmptyMask = (width: number, height: number): SerializedMask => {
  return {
    data: {},
    width,
    height,
  };
};

/**
 * Add a mask index at a specific pixel.
 */
export const addMaskAtPixel = (
  mask: SerializedMask,
  row: number,
  col: number,
  maskIndex: number
): void => {
  const rowKey = String(row);
  const colKey = String(col);

  if (!mask.data[rowKey]) {
    mask.data[rowKey] = {};
  }
  if (!mask.data[rowKey][colKey]) {
    mask.data[rowKey][colKey] = [];
  }
  if (!mask.data[rowKey][colKey].includes(maskIndex)) {
    mask.data[rowKey][colKey].push(maskIndex);
    mask.data[rowKey][colKey].sort((a, b) => a - b);
  }
};

/**
 * Remove a mask index at a specific pixel.
 */
export const removeMaskAtPixel = (
  mask: SerializedMask,
  row: number,
  col: number,
  maskIndex: number
): void => {
  const rowKey = String(row);
  const colKey = String(col);

  if (!mask.data[rowKey]?.[colKey]) return;

  const indices = mask.data[rowKey][colKey];
  const idx = indices.indexOf(maskIndex);
  if (idx !== -1) {
    indices.splice(idx, 1);
  }

  // Clean up empty entries
  if (indices.length === 0) {
    delete mask.data[rowKey][colKey];
    if (Object.keys(mask.data[rowKey]).length === 0) {
      delete mask.data[rowKey];
    }
  }
};

/**
 * Get mask indices at a specific pixel.
 */
export const getMaskIndicesAtPixel = (
  mask: SerializedMask,
  row: number,
  col: number
): number[] => {
  const rowKey = String(row);
  const colKey = String(col);
  return mask.data[rowKey]?.[colKey] ?? [];
};

/**
 * Get the base name from a file path (without extension).
 */
export const getBaseName = (filePath: string): string => {
  const fileName = filePath.split("/").pop() || filePath;
  const lastDot = fileName.lastIndexOf(".");
  return lastDot > 0 ? fileName.substring(0, lastDot) : fileName;
};

/**
 * Get the image base name from a mask filename.
 * Mask files are named like "image_00.feather", "image_01.feather", etc.
 * This strips both the extension and the "_XX" suffix to get "image".
 */
export const getMaskImageBaseName = (maskFileName: string): string => {
  // First get the base name without extension
  const baseName = getBaseName(maskFileName);
  // Then strip the _XX suffix if present (e.g., "image_00" -> "image")
  const match = baseName.match(/^(.+)_\d{2,}$/);
  return match ? match[1] : baseName;
};

// ============================================================================
// NEW MASK/MASKMAP TYPES AND FUNCTIONS
// ============================================================================

/**
 * Sparse binary mask: { rowIndex: { colIndex: 1 } }
 * Only stores pixels that are part of the mask
 */
export type SparseBinaryMask = Record<string, Record<string, 1>>;

/**
 * Sparse color map: { rowIndex: { colIndex: "#RRGGBB" } }
 */
export type SparseColorMap = Record<string, Record<string, string>>;

/**
 * Labels map type
 */
export type LabelsMap = Record<string, { labelId: string; name: string; color: string }>;

/**
 * Mask document structure for Firestore
 * Note: binaryMask is stored in Cloud Storage, not Firestore (too large)
 */
export interface MaskDocument {
  maskId: string;
  labelId: string | null;
  color: string | null;
  /** Storage path for the binary mask file */
  storagePath: string;
  /** Total pixel count in this mask */
  size: number;
  width: number;
  height: number;
}

/**
 * Mask labels mapping: maskId -> labelId (or null if unlabeled)
 */
export type MaskLabelsMap = Record<string, string | null>;

/**
 * MaskMap document structure for Firestore
 * Note: colorMap and maskOverlay are stored in Cloud Storage (too large)
 */
export interface MaskMapDocument {
  maskMapId: string;
  imageId: string;
  /** Dictionary of maskId -> labelId (source of truth for labels) */
  maskLabels: MaskLabelsMap;
  /** Storage path for the colorMap JSON file */
  colorMapStoragePath: string;
  /** Storage path for the maskOverlay JSON file */
  maskOverlayStoragePath: string;
  maskIds: string[];
  /** Dictionary of maskId -> pixel count (for size comparison) */
  maskSizes: Record<string, number>;
  width: number;
  height: number;
}

/**
 * MaskOverlay: 2D array where each pixel stores the index of the smallest
 * mask covering that pixel, or -1 if no mask covers it.
 *
 * Uses indices instead of full UUIDs to reduce payload size significantly.
 * The maskIds array maps index -> maskId.
 *
 * For a 1024x1024 image, using indices instead of UUIDs reduces size from
 * ~37MB to ~4MB (still large but much more manageable).
 */
export interface MaskOverlay {
  width: number;
  height: number;
  /** Array of maskIds - index in this array corresponds to index in data */
  maskIds: string[];
  /** Flattened row-major array: data[row * width + col] = maskIndex or -1 for no mask */
  data: number[];
}

/**
 * Convert ParsedMask sparse data to SparseBinaryMask format
 */
const sparseMaskDataToBinaryMask = (data: SparseMaskData, maskIndex: number): SparseBinaryMask => {
  const binaryMask: SparseBinaryMask = {};

  for (const [rowKey, cols] of Object.entries(data)) {
    for (const [colKey, indices] of Object.entries(cols)) {
      if (indices.includes(maskIndex)) {
        if (!binaryMask[rowKey]) {
          binaryMask[rowKey] = {};
        }
        binaryMask[rowKey][colKey] = 1;
      }
    }
  }

  return binaryMask;
};

/**
 * Count pixels in a sparse binary mask
 */
const countMaskPixels = (binaryMask: SparseBinaryMask): number => {
  let count = 0;
  for (const cols of Object.values(binaryMask)) {
    count += Object.keys(cols).length;
  }
  return count;
};

/**
 * Convert sparse mask data to raw binary Uint8Array for storage
 */
export const sparseMaskDataToRawBinary = (
  data: SparseMaskData,
  width: number,
  height: number,
  maskIndex: number
): Uint8Array => {
  const binary = new Uint8Array(width * height);

  for (const [rowKey, cols] of Object.entries(data)) {
    const row = parseInt(rowKey, 10);
    if (row < 0 || row >= height) continue;

    for (const [colKey, indices] of Object.entries(cols)) {
      const col = parseInt(colKey, 10);
      if (col < 0 || col >= width) continue;

      if (indices.includes(maskIndex)) {
        binary[row * width + col] = 1;
      }
    }
  }

  return binary;
};

/**
 * Convert raw binary Uint8Array to SparseBinaryMask format
 */
export const rawBinaryToSparseMask = (
  binary: Uint8Array,
  width: number,
  height: number
): SparseBinaryMask => {
  const sparseMask: SparseBinaryMask = {};

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const idx = row * width + col;
      if (binary[idx] > 0) {
        const rowKey = String(row);
        const colKey = String(col);
        if (!sparseMask[rowKey]) {
          sparseMask[rowKey] = {};
        }
        sparseMask[rowKey][colKey] = 1;
      }
    }
  }

  return sparseMask;
};

/**
 * Result from preparing a mask for storage
 */
export interface PreparedMask {
  /** Mask document for Firestore (without storagePath - caller adds it) */
  doc: Omit<MaskDocument, 'storagePath'>;
  /** Raw binary data to upload to storage */
  binary: Buffer;
}

/**
 * Prepare a Mask from a ParsedMask
 * Returns the document data and raw binary for separate storage
 */
export const prepareMaskFromParsed = (maskId: string, parsed: ParsedMask): PreparedMask => {
  const binaryMask = sparseMaskDataToBinaryMask(parsed.data, parsed.maskIndex);
  const size = countMaskPixels(binaryMask);

  // Convert sparse data to raw binary for storage
  const rawBinary = sparseMaskDataToRawBinary(parsed.data, parsed.width, parsed.height, parsed.maskIndex);

  return {
    doc: {
      maskId,
      labelId: null, // Initially unlabeled
      color: null,   // No color when unlabeled
      size,
      width: parsed.width,
      height: parsed.height,
    },
    binary: Buffer.from(rawBinary),
  };
};

/**
 * Create a MaskMap from multiple ParsedMasks
 * Initially, all masks are unlabeled so maskLabels maps to null, and colorMap is empty
 * Note: caller must provide storage paths after uploading data
 */
export const createMaskMapFromMasks = (
  maskMapId: string,
  imageId: string,
  maskIds: string[],
  maskSizes: Record<string, number>,
  colorMapStoragePath: string,
  maskOverlayStoragePath: string,
  width: number,
  height: number
): Omit<MaskMapDocument, 'maskIds'> => {
  // Initialize maskLabels with all masks set to null (unlabeled)
  const maskLabels: MaskLabelsMap = {};
  for (const maskId of maskIds) {
    maskLabels[maskId] = null;
  }

  return {
    maskMapId,
    imageId,
    maskLabels,
    colorMapStoragePath,
    maskOverlayStoragePath,
    maskSizes,
    width,
    height,
  };
};

/**
 * Generate a MaskOverlay from mask data.
 * For each pixel, stores the INDEX of the smallest mask covering it.
 *
 * Uses indices instead of full UUIDs to significantly reduce payload size.
 *
 * Algorithm:
 * 1. Build a maskId -> index map
 * 2. Create arrays for mask index and size at each pixel, initialized to -1/Infinity
 * 3. For each mask, iterate over its pixels (scaling coordinates if needed)
 * 4. If the mask's size is smaller than the current stored size, update both
 *
 * @param masks - Array of { maskId, size, binaryMask (sparse format), srcWidth, srcHeight }
 * @param targetWidth - Target overlay width
 * @param targetHeight - Target overlay height
 * @returns MaskOverlay structure with indices instead of maskIds
 */
export const generateMaskOverlay = (
  masks: Array<{ maskId: string; size: number; binaryMask: SparseBinaryMask; srcWidth: number; srcHeight: number }>,
  targetWidth: number,
  targetHeight: number
): MaskOverlay => {
  console.log(`[generateMaskOverlay] Starting with ${masks.length} masks, target: ${targetWidth}x${targetHeight}`);

  // Build maskId array and index lookup map
  const maskIds: string[] = masks.map(m => m.maskId);
  const maskIdToIndex = new Map<string, number>();
  maskIds.forEach((id, idx) => maskIdToIndex.set(id, idx));

  // Initialize arrays: mask index at each pixel (-1 = no mask), and current smallest size
  const totalPixels = Math.max(0, targetWidth * targetHeight);
  const overlayData = new Int32Array(totalPixels);
  overlayData.fill(-1);
  const sizeAtPixel = new Float32Array(totalPixels);
  sizeAtPixel.fill(Number.POSITIVE_INFINITY);

  // Process each mask – iterate DESTINATION pixels and sample from source
  // (nearest-neighbor). This guarantees no gaps when upscaling masks that are
  // smaller than the target resolution.
  for (const { maskId, size, binaryMask, srcWidth, srcHeight } of masks) {
    const maskIndex = maskIdToIndex.get(maskId);
    if (maskIndex === undefined) continue;

    // Scale factors: target / source
    const scaleX = targetWidth / srcWidth;
    const scaleY = targetHeight / srcHeight;

    const srcPixelCount = Object.values(binaryMask).reduce((sum, cols) => sum + Object.keys(cols).length, 0);
    console.log(`[generateMaskOverlay] Mask ${maskIndex}: src=${srcWidth}x${srcHeight}, scale=(${scaleX.toFixed(4)}, ${scaleY.toFixed(4)}), srcPixels=${srcPixelCount}`);

    for (let targetRow = 0; targetRow < targetHeight; targetRow++) {
      const srcRow = Math.floor(targetRow / scaleY);
      if (srcRow < 0 || srcRow >= srcHeight) continue;

      // Skip entire row if no mask data for this source row
      const rowData = binaryMask[String(srcRow)];
      if (!rowData) continue;

      for (let targetCol = 0; targetCol < targetWidth; targetCol++) {
        const srcCol = Math.floor(targetCol / scaleX);
        if (srcCol < 0 || srcCol >= srcWidth) continue;
        if (!rowData[String(srcCol)]) continue;

        const idx = targetRow * targetWidth + targetCol;
        // If this mask is smaller than the current one at this pixel, replace it
        if (size < sizeAtPixel[idx]) {
          overlayData[idx] = maskIndex;
          sizeAtPixel[idx] = size;
        }
      }
    }
  }

  // DEBUG: Count non-empty pixels in overlay
  let filledPixels = 0;
  for (let i = 0; i < overlayData.length; i++) {
    if (overlayData[i] >= 0) filledPixels++;
  }
  console.log(`[generateMaskOverlay] Complete: ${targetWidth}x${targetHeight}, totalPixels=${totalPixels}, filledPixels=${filledPixels}`);

  return {
    width: targetWidth,
    height: targetHeight,
    maskIds,
    data: Array.from(overlayData),
  };
};

/**
 * Blend colors for overlapping labels
 */
const blendColors = (colors: string[]): string => {
  if (colors.length === 0) return "#000000";
  if (colors.length === 1) return colors[0];

  // Simple average blending
  let r = 0, g = 0, b = 0;
  for (const color of colors) {
    const hex = color.replace("#", "");
    r += parseInt(hex.substring(0, 2), 16);
    g += parseInt(hex.substring(2, 4), 16);
    b += parseInt(hex.substring(4, 6), 16);
  }

  r = Math.round(r / colors.length);
  g = Math.round(g / colors.length);
  b = Math.round(b / colors.length);

  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
};

/**
 * Compute colorMap from maskLabels and mask binary data.
 * This rebuilds the entire colorMap from scratch.
 *
 * When targetWidth/targetHeight are provided, coordinates are scaled from each
 * mask's native resolution to the target resolution so the colorMap aligns with
 * the displayed image (always resized to target on upload).
 *
 * @param maskLabels - Dictionary of maskId -> labelId
 * @param masks - Array of mask documents with binaryMask data and source dimensions
 * @param labels - Project labels configuration
 * @param targetWidth - Target width to scale coordinates to (e.g. 1920)
 * @param targetHeight - Target height to scale coordinates to (e.g. 1080)
 * @returns Computed colorMap in target coordinate space
 */
export const computeColorMap = (
  maskLabels: MaskLabelsMap,
  masks: Array<{ maskId: string; binaryMask: SparseBinaryMask; srcWidth?: number; srcHeight?: number }>,
  labels: LabelsMap,
  targetWidth?: number,
  targetHeight?: number
): SparseColorMap => {
  // Track colors at each pixel: { rowKey: { colKey: [color1, color2] } }
  const pixelColors: Record<string, Record<string, string[]>> = {};

  // Process each mask
  for (const mask of masks) {
    const labelId = maskLabels[mask.maskId];
    if (!labelId) {
      continue;
    }

    const color = labels[labelId]?.color;
    if (!color) {
      continue;
    }

    const needsScale = targetWidth && targetHeight && mask.srcWidth && mask.srcHeight &&
      (mask.srcWidth !== targetWidth || mask.srcHeight !== targetHeight);
    const scaleX = needsScale ? targetWidth / mask.srcWidth! : 1;
    const scaleY = needsScale ? targetHeight / mask.srcHeight! : 1;

    for (const [rowKey, cols] of Object.entries(mask.binaryMask)) {
      const srcRow = parseInt(rowKey, 10);

      // When scaling, fill all target rows that map back to this source row
      const tRowStart = needsScale ? Math.floor(srcRow * scaleY) : srcRow;
      const tRowEnd = needsScale ? Math.floor((srcRow + 1) * scaleY) : srcRow + 1;

      for (const colKey of Object.keys(cols)) {
        const srcCol = parseInt(colKey, 10);

        const tColStart = needsScale ? Math.floor(srcCol * scaleX) : srcCol;
        const tColEnd = needsScale ? Math.floor((srcCol + 1) * scaleX) : srcCol + 1;

        for (let tr = tRowStart; tr < tRowEnd; tr++) {
          const rk = String(tr);
          if (!pixelColors[rk]) pixelColors[rk] = {};
          for (let tc = tColStart; tc < tColEnd; tc++) {
            const ck = String(tc);
            if (!pixelColors[rk][ck]) pixelColors[rk][ck] = [];
            if (!pixelColors[rk][ck].includes(color)) {
              pixelColors[rk][ck].push(color);
            }
          }
        }
      }
    }
  }

  // Convert pixel colors to blended colorMap
  const colorMap: SparseColorMap = {};
  for (const [rowKey, cols] of Object.entries(pixelColors)) {
    colorMap[rowKey] = {};
    for (const [colKey, colors] of Object.entries(cols)) {
      if (colors.length > 0) {
        colorMap[rowKey][colKey] = blendColors(colors);
      }
    }
  }

  return colorMap;
};

