/**
 * MaskCanvas - Shared canvas component for rendering mask overlays
 * Uses a single composite buffer (image + mask) and one canvas. No separate image layer.
 * Used by LabelImage, ManagementModal, and PreviewGallery
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MaskOverlay, SparseColorMap } from '../../../types';
import type { CompositeBuffer } from '../../../types/compositeBuffer';
import {
  createCompositeBuffer,
  fillImageIntoBuffer,
  applyMaskToBuffer,
  renderBufferToCanvas,
} from '../../../utils/compositeBuffer';
import './MaskCanvas.css';

// ============ Constants ============
const DEFAULT_OVERLAY_ALPHA = 130;
const DEFAULT_HIGHLIGHT_ALPHA = 255;

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
  const imageRef = useRef<HTMLImageElement>(null);
  const bufferRef = useRef<CompositeBuffer | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);

  const redraw = useCallback(() => {
    const buffer = bufferRef.current;
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!buffer || !canvas || !frame) return;
    const w = frame.clientWidth;
    const h = frame.clientHeight;
    if (w <= 0 || h <= 0) return;
    renderBufferToCanvas(buffer, canvas, w, h);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }, []);

  // Build or update composite buffer when image loads or mask data changes
  useEffect(() => {
    const img = imageRef.current;
    if (!img || !img.complete) return;

    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (nw === 0 || nh === 0) return;

    let buffer = bufferRef.current;
    if (!buffer || buffer.width !== nw || buffer.height !== nh) {
      buffer = createCompositeBuffer(nw, nh);
      bufferRef.current = buffer;
      fillImageIntoBuffer(buffer, img);
    } else if (!imageLoaded) {
      fillImageIntoBuffer(buffer, img);
    }

    applyMaskToBuffer(buffer, {
      maskOverlay: maskOverlay ?? null,
      colorMap,
      highlightedMaskId: highlightedMaskId ?? null,
      highlightColor: highlightColor ?? null,
      overlayAlpha,
      highlightAlpha,
    });

    queueMicrotask(() => setImageLoaded(true));
    redraw();
  }, [
    imageLoaded,
    imageUrl,
    colorMap,
    maskOverlay,
    highlightedMaskId,
    highlightColor,
    overlayAlpha,
    highlightAlpha,
    redraw,
  ]);

  // Image onLoad: trigger buffer build
  const handleImageLoad = useCallback(() => {
    const img = imageRef.current;
    if (!img) return;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (nw === 0 || nh === 0) return;
    const buffer = createCompositeBuffer(nw, nh);
    bufferRef.current = buffer;
    fillImageIntoBuffer(buffer, img);
    setImageLoaded(true);
  }, []);

  // When imageUrl changes, reset so we rebuild on new image load
  useEffect(() => {
    if (!imageUrl) {
      bufferRef.current = null;
      queueMicrotask(() => setImageLoaded(false));
    }
  }, [imageUrl]);

  // Redraw when frame size changes
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(redraw);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [redraw]);

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
          ref={imageRef}
          src={imageUrl}
          alt={imageAlt}
          loading="lazy"
          className="mask-canvas-image mask-canvas-image-hidden"
          onLoad={handleImageLoad}
        />
      ) : (
        <div className="mask-canvas-fallback">
          <span>No image URL</span>
        </div>
      )}

      <canvas ref={canvasRef} className="mask-canvas-overlay mask-canvas-overlay-single" />

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
