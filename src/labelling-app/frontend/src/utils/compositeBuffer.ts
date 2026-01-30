import type { SparseColorMap, MaskOverlay, MaskApiItem } from '../types';
import type { CompositeBuffer } from '../types/compositeBuffer';
import { setMaskAtPixel } from '../types/compositeBuffer';

export { createCompositeBuffer } from '../types/compositeBuffer';
export type { CompositeBuffer } from '../types/compositeBuffer';

const DEFAULT_OVERLAY_ALPHA = 130;
const DEFAULT_HIGHLIGHT_ALPHA = 255;
const UNLABELED_RGB = [59, 130, 246] as const;

function parseHex(hex: string): [number, number, number] {
  const s = hex.replace('#', '');
  if (s.length < 6) return [...UNLABELED_RGB];
  const r = parseInt(s.substring(0, 2), 16);
  const g = parseInt(s.substring(2, 4), 16);
  const b = parseInt(s.substring(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return [...UNLABELED_RGB];
  return [r, g, b];
}

/**
 * Fill composite buffer with image RGB; set all mask bytes to 0.
 * imageElement must be loaded (complete). Buffer dimensions should match image natural size.
 */
export function fillImageIntoBuffer(
  buffer: CompositeBuffer,
  imageElement: HTMLImageElement
): void {
  const { width, height, data } = buffer;
  const naturalWidth = imageElement.naturalWidth;
  const naturalHeight = imageElement.naturalHeight;
  if (naturalWidth === 0 || naturalHeight === 0) return;
  if (width !== naturalWidth || height !== naturalHeight) return;

  const temp = document.createElement('canvas');
  temp.width = naturalWidth;
  temp.height = naturalHeight;
  const ctx = temp.getContext('2d');
  if (!ctx) return;
  ctx.drawImage(imageElement, 0, 0);
  const imageData = ctx.getImageData(0, 0, naturalWidth, naturalHeight);
  const src = imageData.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = (y * width + x) * 7;
      data[dstIdx] = src[srcIdx];
      data[dstIdx + 1] = src[srcIdx + 1];
      data[dstIdx + 2] = src[srcIdx + 2];
      data[dstIdx + 3] = 0;
      data[dstIdx + 4] = 0;
      data[dstIdx + 5] = 0;
      data[dstIdx + 6] = 0;
    }
  }
}

export interface ApplyMaskOptions {
  maskOverlay: MaskOverlay | null;
  colorMap: SparseColorMap | null | undefined;
  highlightedMaskId: string | null;
  highlightColor: string | null;
  masks?: MaskApiItem[];
  overlayAlpha?: number;
  highlightAlpha?: number;
}

/**
 * Clear all mask bytes in the buffer (set to 0). Keeps image RGB unchanged.
 */
export function clearMaskInBuffer(buffer: CompositeBuffer): void {
  const { width, height, data } = buffer;
  for (let i = 0; i < width * height; i++) {
    const o = i * 7;
    data[o + 3] = 0;
    data[o + 4] = 0;
    data[o + 5] = 0;
    data[o + 6] = 0;
  }
}

/**
 * Update only the mask bytes (maskR, maskG, maskB, maskAlpha) in the buffer.
 * Clears mask first, then applies colorMap, then highlight. Buffer dimensions must match maskOverlay dimensions (image natural size).
 */
export function applyMaskToBuffer(buffer: CompositeBuffer, options: ApplyMaskOptions): void {
  const {
    maskOverlay,
    colorMap,
    highlightedMaskId,
    highlightColor,
    masks = [],
    overlayAlpha = DEFAULT_OVERLAY_ALPHA,
    highlightAlpha = DEFAULT_HIGHLIGHT_ALPHA,
  } = options;

  clearMaskInBuffer(buffer);

  const { width, height, data } = buffer;
  const masksById = new Map(masks.map((m) => [m.maskId, m]));

  if (colorMap && Object.keys(colorMap).length > 0) {
    for (const [rowKey, cols] of Object.entries(colorMap)) {
      const row = parseInt(rowKey, 10);
      if (row < 0 || row >= height) continue;
      for (const [colKey, hexColor] of Object.entries(cols)) {
        const col = parseInt(colKey, 10);
        if (col < 0 || col >= width) continue;
        const [r, g, b] = parseHex(hexColor);
        setMaskAtPixel(data, width, col, row, r, g, b, overlayAlpha);
      }
    }
  }

  if (highlightedMaskId && maskOverlay) {
    const overlay = maskOverlay;
    const mask = masksById.get(highlightedMaskId);
    const isLabeled = mask?.labelId != null;
    let r = UNLABELED_RGB[0];
    let g = UNLABELED_RGB[1];
    let b = UNLABELED_RGB[2];
    if (isLabeled && mask?.color) {
      [r, g, b] = parseHex(mask.color);
    } else if (highlightColor) {
      [r, g, b] = parseHex(highlightColor);
    }
    const highlightIndex = overlay.maskIds.indexOf(highlightedMaskId);
    if (highlightIndex >= 0) {
      const ow = overlay.width;
      const oh = overlay.height;
      for (let i = 0; i < overlay.data.length; i++) {
        if (overlay.data[i] !== highlightIndex) continue;
        const row = Math.floor(i / ow);
        const col = i % ow;
        if (row >= 0 && row < height && col >= 0 && col < width) {
          setMaskAtPixel(data, width, col, row, r, g, b, highlightAlpha);
        }
      }
    }
  }
}

/**
 * Render composite buffer to canvas: blend image + mask per pixel, then draw.
 * If displayWidth/displayHeight are provided and differ from buffer size, scale via offscreen canvas.
 */
export function renderBufferToCanvas(
  buffer: CompositeBuffer,
  canvas: HTMLCanvasElement,
  displayWidth?: number,
  displayHeight?: number
): void {
  const { width, height, data } = buffer;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const outW = displayWidth ?? width;
  const outH = displayHeight ?? height;

  if (outW <= 0 || outH <= 0) return;

  if (width === outW && height === outH) {
    const imageData = ctx.createImageData(width, height);
    const out = imageData.data;
    for (let i = 0; i < width * height; i++) {
      const o = i * 7;
      const a = data[o + 6];
      const inv = 255 - a;
      out[i * 4] = Math.round((data[o] * inv + data[o + 3] * a) / 255);
      out[i * 4 + 1] = Math.round((data[o + 1] * inv + data[o + 4] * a) / 255);
      out[i * 4 + 2] = Math.round((data[o + 2] * inv + data[o + 5] * a) / 255);
      out[i * 4 + 3] = 255;
    }
    canvas.width = width;
    canvas.height = height;
    ctx.putImageData(imageData, 0, 0);
    return;
  }

  const offscreen = document.createElement('canvas');
  offscreen.width = width;
  offscreen.height = height;
  const offCtx = offscreen.getContext('2d');
  if (!offCtx) return;
  const imageData = offCtx.createImageData(width, height);
  const out = imageData.data;
  for (let i = 0; i < width * height; i++) {
    const o = i * 7;
    const a = data[o + 6];
    const inv = 255 - a;
    out[i * 4] = Math.round((data[o] * inv + data[o + 3] * a) / 255);
    out[i * 4 + 1] = Math.round((data[o + 1] * inv + data[o + 4] * a) / 255);
    out[i * 4 + 2] = Math.round((data[o + 2] * inv + data[o + 5] * a) / 255);
    out[i * 4 + 3] = 255;
  }
  offCtx.putImageData(imageData, 0, 0);

  canvas.width = outW;
  canvas.height = outH;
  ctx.drawImage(offscreen, 0, 0, width, height, 0, 0, outW, outH);
}
