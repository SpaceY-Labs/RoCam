import type { SparseColorMap, MaskOverlay, MaskApiItem } from '../types';
import type { InteractiveMap, InteractiveMapCoordinates } from '../types/interactiveMap';

const LABELED_OPACITY = 0.3;
const HIGHLIGHT_OPACITY = 1.0;
const UNLABELED_COLOR = { r: 59, g: 130, b: 246 };

function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const s = hex.replace('#', '');
  return {
    r: parseInt(s.substring(0, 2), 16),
    g: parseInt(s.substring(2, 4), 16),
    b: parseInt(s.substring(4, 6), 16),
  };
}

/**
 * Build a complete InteractiveMap: pre-rendered mask canvas + coordinates + lookup.
 * Uses image and wrapper DOM state at call time (single getBoundingClientRect each).
 */
export function buildInteractiveMap(
  imageElement: HTMLImageElement,
  wrapperElement: HTMLDivElement,
  colorMap: SparseColorMap | null,
  maskOverlay: MaskOverlay | null,
  highlightedMaskId: string | null,
  masks: MaskApiItem[]
): InteractiveMap | null {
  const imgRect = imageElement.getBoundingClientRect();
  const wrapperRect = wrapperElement.getBoundingClientRect();

  const offsetX = imgRect.left - wrapperRect.left;
  const offsetY = imgRect.top - wrapperRect.top;
  const displayedWidth = imgRect.width;
  const displayedHeight = imgRect.height;
  const naturalWidth = imageElement.naturalWidth;
  const naturalHeight = imageElement.naturalHeight;

  if (naturalWidth === 0 || naturalHeight === 0) return null;
  if (!maskOverlay) return null;

  const overlay = maskOverlay;
  const scaleX = displayedWidth / naturalWidth;
  const scaleY = displayedHeight / naturalHeight;

  const coordinates: InteractiveMapCoordinates = {
    displayWidth: displayedWidth,
    displayHeight: displayedHeight,
    offsetX,
    offsetY,
    naturalWidth,
    naturalHeight,
    scaleX,
    scaleY,
  };

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(displayedWidth);
  canvas.height = Math.floor(displayedHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const imageData = ctx.createImageData(canvas.width, canvas.height);
  const data = imageData.data;
  const masksById = new Map(masks.map((m) => [m.maskId, m]));

  if (colorMap) {
    for (const [rowKey, cols] of Object.entries(colorMap)) {
      const srcRow = parseInt(rowKey, 10);
      if (srcRow < 0 || srcRow >= naturalHeight) continue;
      const destRow = Math.floor(srcRow * scaleY);
      if (destRow < 0 || destRow >= canvas.height) continue;

      for (const [colKey, hexColor] of Object.entries(cols)) {
        const srcCol = parseInt(colKey, 10);
        if (srcCol < 0 || srcCol >= naturalWidth) continue;
        const destCol = Math.floor(srcCol * scaleX);
        if (destCol < 0 || destCol >= canvas.width) continue;

        const { r, g, b } = parseHexColor(hexColor);
        const idx = (destRow * canvas.width + destCol) * 4;
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = Math.round(255 * LABELED_OPACITY);
      }
    }
  }

  if (highlightedMaskId) {
    const highlightedMask = masksById.get(highlightedMaskId);
    const isLabeled = highlightedMask?.labelId !== null;
    let r = UNLABELED_COLOR.r;
    let g = UNLABELED_COLOR.g;
    let b = UNLABELED_COLOR.b;
    if (isLabeled && highlightedMask?.color) {
      const parsed = parseHexColor(highlightedMask.color);
      r = parsed.r;
      g = parsed.g;
      b = parsed.b;
    }

    const highlightedIndex = maskOverlay.maskIds.indexOf(highlightedMaskId);
    if (highlightedIndex !== -1) {
      const maskWidth = maskOverlay.width;
      for (let i = 0; i < maskOverlay.data.length; i++) {
        if (maskOverlay.data[i] === highlightedIndex) {
          const srcRow = Math.floor(i / maskWidth);
          const srcCol = i % maskWidth;
          const destRow = Math.floor(srcRow * scaleY);
          const destCol = Math.floor(srcCol * scaleX);
          if (
            destRow >= 0 &&
            destRow < canvas.height &&
            destCol >= 0 &&
            destCol < canvas.width
          ) {
            const idx = (destRow * canvas.width + destCol) * 4;
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = Math.round(255 * HIGHLIGHT_OPACITY);
          }
        }
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);

  function getMaskAtPosition(
    clientX: number,
    clientY: number,
    imageRect: DOMRect
  ): string | null {
    const mouseX = clientX - imageRect.left;
    const mouseY = clientY - imageRect.top;
    if (mouseX < 0 || mouseY < 0 || mouseX >= imageRect.width || mouseY >= imageRect.height) {
      return null;
    }
    const invScaleX = naturalWidth / imageRect.width;
    const invScaleY = naturalHeight / imageRect.height;
    const col = Math.floor(
      Math.max(0, Math.min(overlay.width - 1, mouseX * invScaleX))
    );
    const row = Math.floor(
      Math.max(0, Math.min(overlay.height - 1, mouseY * invScaleY))
    );
    const idx = row * overlay.width + col;
    const maskIndex = overlay.data[idx];
    return maskIndex >= 0 ? overlay.maskIds[maskIndex] : null;
  }

  return {
    canvas,
    coordinates,
    maskOverlay: overlay,
    getMaskAtPosition,
  };
}
