/**
 * MaskCanvas - Shared canvas component for rendering mask overlays
 * Used by LabelImage, ManagementModal, and PreviewGallery
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { MaskOverlay, SparseColorMap } from '../../../types';
import './MaskCanvas.css';

// ============ Constants ============
const DEFAULT_OVERLAY_ALPHA = 130;
const DEFAULT_HIGHLIGHT_ALPHA = 255;
const DEFAULT_UNLABELED_COLOR = '#3B82F6';

// ============ Types ============
export interface MaskCanvasProps {
  /** Image source URL */
  imageUrl: string | undefined;
  /** Image alt text */
  imageAlt?: string;
  /** Image dimensions for aspect ratio */
  imageWidth?: number;
  imageHeight?: number;
  /** Color map for labeled masks */
  colorMap: SparseColorMap | null | undefined;
  /** Mask overlay data for hover detection */
  maskOverlay?: MaskOverlay | null;
  /** Currently highlighted mask ID */
  highlightedMaskId?: string | null;
  /** Color for highlighted mask (defaults to label color or blue) */
  highlightColor?: string | null;
  /** Opacity for labeled masks (0-255) */
  overlayAlpha?: number;
  /** Opacity for highlighted mask (0-255) */
  highlightAlpha?: number;
  /** Whether to enable mouse interactions */
  interactive?: boolean;
  /** Callback when mouse moves over canvas */
  onMouseMove?: (maskId: string | null, event: React.MouseEvent) => void;
  /** Callback when mouse leaves canvas */
  onMouseLeave?: () => void;
  /** Callback when canvas is clicked */
  onClick?: (maskId: string | null, event: React.MouseEvent) => void;
  /** CSS class name */
  className?: string;
  /** Loading state for mask data */
  maskLoading?: boolean;
  /** Whether image is loading */
  imageLoading?: boolean;
  /** Status overlay content */
  statusContent?: React.ReactNode;
}

// ============ Helpers ============

/**
 * Parse hex color string to RGB tuple
 */
const parseHexColor = (
  hexColor: string,
  fallback: [number, number, number] = [59, 130, 246]
): [number, number, number] => {
  const hex = hexColor.replace('#', '');
  if (hex.length < 6) return fallback;

  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return fallback;
  }
  return [r, g, b];
};

// ============ Component ============
export function MaskCanvas({
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
  interactive = false,
  onMouseMove,
  onMouseLeave,
  onClick,
  className = '',
  maskLoading = false,
  statusContent,
}: MaskCanvasProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastLoggedDims = useRef<string>('');

  // Cache for parsed hex colors to avoid repeated parsing
  const colorCache = useMemo(() => new Map<string, [number, number, number]>(), []);

  // ============ Canvas Drawing ============

  /**
   * Draw the mask overlay on the canvas
   */
  const drawOverlay = useCallback(() => {
    const frame = frameRef.current;
    const canvas = canvasRef.current;
    if (!frame || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = frame.clientWidth;
    const height = frame.clientHeight;
    if (width === 0 || height === 0) return;

    // Handle high DPI displays
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, width, height);

    const hasColorMap = Boolean(colorMap && Object.keys(colorMap).length > 0);
    const hasHighlight = Boolean(highlightedMaskId && maskOverlay);

    if (!hasColorMap && !hasHighlight) return;

    const srcWidth = maskOverlay?.width || imageWidth || width;
    const srcHeight = maskOverlay?.height || imageHeight || height;

    // DEBUG: Log dimensions (throttled - only when dimensions change)
    const dimsKey = `${width}x${height}-${maskOverlay?.width}x${maskOverlay?.height}-${imageWidth}x${imageHeight}`;
    if (lastLoggedDims.current !== dimsKey) {
      lastLoggedDims.current = dimsKey;
      const rect = frame.getBoundingClientRect();
      const imgElement = frame.querySelector('img');
      const imgRect = imgElement?.getBoundingClientRect();
      console.log('[drawOverlay] Dimensions:', {
        frame: { clientWidth: width, clientHeight: height },
        boundingRect: { width: rect.width, height: rect.height },
        maskOverlay: maskOverlay ? { width: maskOverlay.width, height: maskOverlay.height, dataLength: maskOverlay.data?.length } : null,
        imageProps: { imageWidth, imageHeight },
        computed: { srcWidth, srcHeight },
        dpr,
        canvasActual: { width: canvas.width, height: canvas.height },
        imgElement: imgElement ? {
          naturalWidth: imgElement.naturalWidth,
          naturalHeight: imgElement.naturalHeight,
          clientWidth: imgElement.clientWidth,
          clientHeight: imgElement.clientHeight,
          boundingRect: imgRect ? { width: imgRect.width, height: imgRect.height, left: imgRect.left - rect.left, top: imgRect.top - rect.top } : null,
        } : null,
        aspectRatioStyle: frame.style.aspectRatio,
      });
    }

    if (!srcWidth || !srcHeight) return;

    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    // Draw labeled masks from colorMap
    if (hasColorMap && colorMap) {
      for (const [rowKey, cols] of Object.entries(colorMap)) {
        const row = Number(rowKey);
        if (!Number.isFinite(row) || row < 0 || row >= srcHeight) continue;

        const destY = Math.floor((row / srcHeight) * height);
        const destRow = destY * width * 4;

        for (const [colKey, hexColor] of Object.entries(cols)) {
          const col = Number(colKey);
          if (!Number.isFinite(col) || col < 0 || col >= srcWidth) continue;

          const destX = Math.floor((col / srcWidth) * width);
          const dest = destRow + destX * 4;

          let rgb = colorCache.get(hexColor);
          if (!rgb) {
            rgb = parseHexColor(hexColor);
            colorCache.set(hexColor, rgb);
          }

          data[dest] = rgb[0];
          data[dest + 1] = rgb[1];
          data[dest + 2] = rgb[2];
          data[dest + 3] = overlayAlpha;
        }
      }
    }

    // Draw highlighted mask at full opacity
    if (hasHighlight && maskOverlay && highlightedMaskId) {
      const highlightIndex = maskOverlay.maskIds.indexOf(highlightedMaskId);
      if (highlightIndex >= 0) {
        const color = highlightColor || DEFAULT_UNLABELED_COLOR;
        const [r, g, b] = parseHexColor(color);
        const overlayWidth = maskOverlay.width;
        const overlayHeight = maskOverlay.height;

        let sampleLogged = false;
        let pixelCount = 0;
        for (let i = 0; i < maskOverlay.data.length; i++) {
          if (maskOverlay.data[i] !== highlightIndex) continue;
          pixelCount++;

          const srcY = Math.floor(i / overlayWidth);
          const srcX = i - srcY * overlayWidth;
          const destX = Math.floor((srcX / overlayWidth) * width);
          const destY = Math.floor((srcY / overlayHeight) * height);

          // DEBUG: Log first pixel mapping for this highlight
          if (!sampleLogged) {
            console.log('[drawOverlay] Highlight pixel mapping sample:', {
              maskId: highlightedMaskId,
              highlightIndex,
              src: { srcX, srcY, i },
              dest: { destX, destY },
              scale: { xScale: width / overlayWidth, yScale: height / overlayHeight },
              overlay: { overlayWidth, overlayHeight },
              canvas: { width, height },
            });
            sampleLogged = true;
          }

          if (destX < 0 || destX >= width || destY < 0 || destY >= height) continue;

          const dest = (destY * width + destX) * 4;
          data[dest] = r;
          data[dest + 1] = g;
          data[dest + 2] = b;
          data[dest + 3] = highlightAlpha;
        }
        console.log('[drawOverlay] Highlight total pixels:', { maskId: highlightedMaskId, pixelCount });
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }, [
    colorMap,
    colorCache,
    highlightAlpha,
    highlightColor,
    highlightedMaskId,
    imageHeight,
    imageWidth,
    maskOverlay,
    overlayAlpha,
  ]);

  // Redraw when dependencies change
  useEffect(() => {
    drawOverlay();
  }, [drawOverlay]);

  // Handle resize
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const observer = new ResizeObserver(() => drawOverlay());
    observer.observe(frame);
    return () => observer.disconnect();
  }, [drawOverlay]);

  // ============ Mouse Handlers ============

  /**
   * Get mask ID at a given screen position
   */
  const getMaskAtPosition = useCallback(
    (clientX: number, clientY: number): string | null => {
      if (!maskOverlay || !frameRef.current) return null;

      const rect = frameRef.current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      if (maskOverlay.width === 0 || maskOverlay.height === 0) return null;

      const relativeX = (clientX - rect.left) / rect.width;
      const relativeY = (clientY - rect.top) / rect.height;

      if (relativeX < 0 || relativeX > 1 || relativeY < 0 || relativeY > 1) {
        return null;
      }

      const col = Math.floor(relativeX * maskOverlay.width);
      const row = Math.floor(relativeY * maskOverlay.height);
      const idx = row * maskOverlay.width + col;
      const maskIndex = maskOverlay.data[idx];

      // DEBUG: Log click position mapping (throttled - only on actual clicks, not mouse moves)
      // This log will show in handleClick, not handleMouseMove

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

      // DEBUG: Log click details
      if (maskOverlay && frameRef.current) {
        const rect = frameRef.current.getBoundingClientRect();
        const relativeX = (event.clientX - rect.left) / rect.width;
        const relativeY = (event.clientY - rect.top) / rect.height;
        const col = Math.floor(relativeX * maskOverlay.width);
        const row = Math.floor(relativeY * maskOverlay.height);
        const idx = row * maskOverlay.width + col;
        console.log('[handleClick] Click:', {
          client: { x: event.clientX, y: event.clientY },
          rect: { width: rect.width, height: rect.height },
          relative: { x: relativeX.toFixed(4), y: relativeY.toFixed(4) },
          maskCoords: { col, row, idx },
          overlay: { width: maskOverlay.width, height: maskOverlay.height },
          result: { maskId, maskIndex: maskOverlay.data[idx] },
        });
      }

      onClick(maskId, event);
    },
    [interactive, onClick, getMaskAtPosition, maskOverlay]
  );

  // ============ Render ============

  const aspectRatio = imageWidth && imageHeight
    ? `${imageWidth} / ${imageHeight}`
    : '1 / 1';

  return (
    <div
      ref={frameRef}
      className={`mask-canvas ${className}`.trim()}
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
          className="mask-canvas-image"
        />
      ) : (
        <div className="mask-canvas-fallback">
          <span>No image URL</span>
        </div>
      )}

      <canvas ref={canvasRef} className="mask-canvas-overlay" />

      {maskLoading && (
        <div className="mask-canvas-status">
          <div className="loading-spinner" />
          <span>Loading masks...</span>
        </div>
      )}

      {statusContent}
    </div>
  );
}

export default MaskCanvas;
