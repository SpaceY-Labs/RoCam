/**
 * InteractiveMapOverlay - Two-layer rendering (visible img + mask-only overlay canvas).
 *
 * Uses the same proven approach as PreviewCard and the old ManagementModal:
 *   - <img> renders the image (visible, fills the frame)
 *   - <canvas> draws mask colors as a transparent overlay on top
 *
 * This avoids the cross-origin canvas taint issue that occurs when reading
 * image pixel data from GCS signed URLs via getImageData().
 *
 * Hit-testing uses getBoundingClientRect() for zoom-immune coordinate mapping.
 * ResizeObserver + matchMedia for redraw. Wheel preventDefault blocks Ctrl+zoom.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MaskApiItem, MaskOverlay, SparseColorMap } from '../../../types';
import './InteractiveMapOverlay.css';

const DEFAULT_OVERLAY_ALPHA = 130;
const DEFAULT_HIGHLIGHT_ALPHA = 255;
const UNLABELED_RGB: readonly [number, number, number] = [59, 130, 246];

function parseHex(hex: string): [number, number, number] {
  const s = hex.replace('#', '');
  if (s.length < 6) return [...UNLABELED_RGB];
  const r = parseInt(s.substring(0, 2), 16);
  const g = parseInt(s.substring(2, 4), 16);
  const b = parseInt(s.substring(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return [...UNLABELED_RGB];
  return [r, g, b];
}

export interface InteractiveMapOverlayProps {
  imageUrl: string | undefined;
  imageAlt?: string;
  imageWidth?: number;
  imageHeight?: number;
  colorMap: SparseColorMap | null | undefined;
  maskOverlay?: MaskOverlay | null;
  highlightedMaskId?: string | null;
  highlightColor?: string | null;
  overlayAlpha?: number;
  highlightAlpha?: number;
  masks?: MaskApiItem[];
  interactive?: boolean;
  onMouseMove?: (maskId: string | null, event: React.MouseEvent) => void;
  onMouseLeave?: () => void;
  onClick?: (maskId: string | null, event: React.MouseEvent) => void;
  className?: string;
  maskLoading?: boolean;
  statusContent?: React.ReactNode;
}

export function InteractiveMapOverlay({
  imageUrl,
  imageAlt = 'Image',
  imageWidth,
  imageHeight,
  colorMap,
  maskOverlay,
  highlightedMaskId,
  highlightColor,
  overlayAlpha = DEFAULT_OVERLAY_ALPHA,
  highlightAlpha = DEFAULT_HIGHLIGHT_ALPHA,
  masks = [],
  interactive = false,
  onMouseMove,
  onMouseLeave,
  onClick,
  className = '',
  maskLoading = false,
  statusContent,
}: InteractiveMapOverlayProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [, setImageLoaded] = useState(false);

  const colorCache = useMemo(() => new Map<string, [number, number, number]>(), []);

  // ============ Overlay Drawing (mask-only, no image pixels) ============
  const drawOverlay = useCallback(() => {
    const frame = frameRef.current;
    const canvas = canvasRef.current;
    if (!frame || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Use getBoundingClientRect for sub-pixel accurate CSS dimensions.
    const rect = frame.getBoundingClientRect();
    const cssW = rect.width;
    const cssH = rect.height;
    if (cssW <= 0 || cssH <= 0) return;

    const intW = Math.round(cssW);
    const intH = Math.round(cssH);
    if (intW <= 0 || intH <= 0) return;

    canvas.width = intW;
    canvas.height = intH;
    // CSS width/height handled by stylesheet (100% of parent)

    ctx.clearRect(0, 0, intW, intH);

    const hasColorMap = Boolean(colorMap && Object.keys(colorMap).length > 0);
    const hasHighlight = Boolean(highlightedMaskId && maskOverlay);
    if (!hasColorMap && !hasHighlight) return;

    const srcWidth = maskOverlay?.width || imageWidth || cssW;
    const srcHeight = maskOverlay?.height || imageHeight || cssH;
    if (!srcWidth || !srcHeight) return;

    const imageData = ctx.createImageData(intW, intH);
    const data = imageData.data;

    // Draw color map (labeled masks)
    if (hasColorMap && colorMap) {
      for (const [rowKey, cols] of Object.entries(colorMap)) {
        const row = Number(rowKey);
        if (!Number.isFinite(row) || row < 0 || row >= srcHeight) continue;
        const destY = Math.floor((row / srcHeight) * intH);
        const destRow = destY * intW * 4;

        for (const [colKey, hexColor] of Object.entries(cols)) {
          const col = Number(colKey);
          if (!Number.isFinite(col) || col < 0 || col >= srcWidth) continue;
          const destX = Math.floor((col / srcWidth) * intW);
          const dest = destRow + destX * 4;

          let rgb = colorCache.get(hexColor);
          if (!rgb) {
            rgb = parseHex(hexColor);
            colorCache.set(hexColor, rgb);
          }

          data[dest] = rgb[0];
          data[dest + 1] = rgb[1];
          data[dest + 2] = rgb[2];
          data[dest + 3] = overlayAlpha;
        }
      }
    }

    // Draw highlighted mask
    if (hasHighlight && maskOverlay && highlightedMaskId) {
      const highlightIndex = maskOverlay.maskIds.indexOf(highlightedMaskId);
      if (highlightIndex >= 0) {
        // Resolve highlight color from mask label or prop
        const masksById = new Map(masks.map((m) => [m.maskId, m]));
        const mask = masksById.get(highlightedMaskId);
        const isLabeled = mask?.labelId != null;
        let rgb: [number, number, number];
        if (isLabeled && mask?.color) {
          rgb = parseHex(mask.color);
        } else if (highlightColor) {
          rgb = parseHex(highlightColor);
        } else {
          rgb = [...UNLABELED_RGB];
        }

        const overlayWidth = maskOverlay.width;
        const overlayHeight = maskOverlay.height;

        for (let i = 0; i < maskOverlay.data.length; i++) {
          if (maskOverlay.data[i] !== highlightIndex) continue;
          const srcY = Math.floor(i / overlayWidth);
          const srcX = i - srcY * overlayWidth;
          const destX = Math.floor((srcX / overlayWidth) * intW);
          const destY = Math.floor((srcY / overlayHeight) * intH);
          if (destX < 0 || destX >= intW || destY < 0 || destY >= intH) continue;
          const dest = (destY * intW + destX) * 4;
          data[dest] = rgb[0];
          data[dest + 1] = rgb[1];
          data[dest + 2] = rgb[2];
          data[dest + 3] = highlightAlpha;
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }, [
    colorMap,
    colorCache,
    highlightColor,
    highlightedMaskId,
    highlightAlpha,
    imageHeight,
    imageWidth,
    maskOverlay,
    masks,
    overlayAlpha,
  ]);

  // Redraw when overlay data changes
  useEffect(() => {
    drawOverlay();
  }, [drawOverlay]);

  // Redraw when frame size changes (browser zoom, layout shift)
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(() => drawOverlay());
    observer.observe(frame);
    return () => observer.disconnect();
  }, [drawOverlay]);

  // Prevent Ctrl+wheel / Meta+wheel browser zoom over the overlay
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    };
    frame.addEventListener('wheel', onWheel, { passive: false });
    return () => frame.removeEventListener('wheel', onWheel);
  }, []);

  // ============ Mouse Handlers ============
  const getMaskAtPosition = useCallback(
    (clientX: number, clientY: number): string | null => {
      if (!maskOverlay || !frameRef.current) return null;
      const rect = frameRef.current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      if (maskOverlay.width === 0 || maskOverlay.height === 0) return null;
      const relativeX = (clientX - rect.left) / rect.width;
      const relativeY = (clientY - rect.top) / rect.height;
      if (relativeX < 0 || relativeX > 1 || relativeY < 0 || relativeY > 1) return null;
      const col = Math.floor(relativeX * maskOverlay.width);
      const row = Math.floor(relativeY * maskOverlay.height);
      const idx = row * maskOverlay.width + col;
      const maskIndex = maskOverlay.data[idx];
      if (maskIndex === undefined || maskIndex < 0) return null;
      return maskOverlay.maskIds[maskIndex] ?? null;
    },
    [maskOverlay]
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!interactive || !onMouseMove) return;
      const maskId = getMaskAtPosition(event.clientX, event.clientY);
      onMouseMove(maskId, event);
    },
    [interactive, onMouseMove, getMaskAtPosition]
  );

  const handleMouseLeave = useCallback(() => {
    if (!interactive || !onMouseLeave) return;
    onMouseLeave();
  }, [interactive, onMouseLeave]);

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!interactive || !onClick) return;
      const maskId = getMaskAtPosition(event.clientX, event.clientY);
      onClick(maskId, event);
    },
    [interactive, onClick, getMaskAtPosition]
  );

  // ============ Render ============
  const aspectRatio =
    imageWidth && imageHeight ? `${imageWidth} / ${imageHeight}` : '1 / 1';

  return (
    <div
      ref={frameRef}
      className={`interactive-map-overlay ${className}`.trim()}
      data-testid="interactive-map-overlay"
      style={{
        aspectRatio,
        cursor: interactive && maskOverlay ? 'crosshair' : 'default',
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={imageAlt}
          loading="lazy"
          className="interactive-map-overlay-image"
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageLoaded(false)}
        />
      ) : (
        <div className="interactive-map-overlay-fallback">
          <span>No image URL</span>
        </div>
      )}

      <canvas
        ref={canvasRef}
        className="interactive-map-overlay-canvas"
        data-testid="interactive-map-canvas"
      />

      {maskLoading && (
        <div className="interactive-map-overlay-status" data-testid="overlay-loading">
          <div className="loading-spinner" />
          <span>Loading masks...</span>
        </div>
      )}

      {statusContent}
    </div>
  );
}

export default InteractiveMapOverlay;
