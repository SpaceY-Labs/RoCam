/**
 * PreviewCard - Individual image preview card in gallery
 * Shows thumbnail with mask overlay and metadata
 */

import { useCallback, useEffect, useRef } from 'react';
import type { ProjectImage, SparseColorMap } from '../../../types';
import { Card } from '../../../components/ui';

// ============ Constants ============
const OVERLAY_ALPHA = 130;

// ============ Types ============
export interface PreviewCardProps {
  /** Image data */
  image: ProjectImage;
  /** Color map for mask overlay */
  colorMap: SparseColorMap | null | undefined;
}

// ============ Helper Components ============

function ImagePreview({
  image,
  colorMap,
  className = '',
}: {
  image: ProjectImage;
  colorMap: SparseColorMap | null | undefined;
  className?: string;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colorCacheRef = useRef(new Map<string, [number, number, number]>());

  const drawOverlay = useCallback(() => {
    const colorCache = colorCacheRef.current;
    const frame = frameRef.current;
    const canvas = canvasRef.current;
    if (!frame || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = frame.clientWidth;
    const height = frame.clientHeight;
    if (width === 0 || height === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, width, height);

    if (!colorMap || Object.keys(colorMap).length === 0) {
      return;
    }

    const srcWidth = image.meta.width || width;
    const srcHeight = image.meta.height || height;
    if (!srcWidth || !srcHeight) return;

    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

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
          const hex = hexColor.replace('#', '');
          const r = parseInt(hex.substring(0, 2), 16);
          const g = parseInt(hex.substring(2, 4), 16);
          const b = parseInt(hex.substring(4, 6), 16);
          rgb = [
            Number.isNaN(r) ? 59 : r,
            Number.isNaN(g) ? 130 : g,
            Number.isNaN(b) ? 246 : b,
          ];
          colorCache.set(hexColor, rgb);
        }

        data[dest] = rgb[0];
        data[dest + 1] = rgb[1];
        data[dest + 2] = rgb[2];
        data[dest + 3] = OVERLAY_ALPHA;
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }, [colorMap, image.meta.height, image.meta.width]);

  useEffect(() => {
    drawOverlay();
  }, [drawOverlay]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(() => drawOverlay());
    observer.observe(frame);
    return () => observer.disconnect();
  }, [drawOverlay]);

  return (
    <div
      className={`gallery-thumb ${className}`.trim()}
      ref={frameRef}
      style={{
        aspectRatio:
          image.meta.width && image.meta.height
            ? `${image.meta.width} / ${image.meta.height}`
            : '1 / 1',
      }}
    >
      {image.fileUrl ? (
        <img src={image.fileUrl} alt={image.meta.fileName} loading="lazy" />
      ) : (
        <div className="gallery-fallback">
          <span>No image URL</span>
        </div>
      )}
      <canvas ref={canvasRef} className="gallery-overlay" />
      {colorMap === undefined && (
        <div className="gallery-overlay-status">
          <div className="loading-spinner" />
          <span>Loading labels...</span>
        </div>
      )}
      {colorMap !== undefined && (!colorMap || Object.keys(colorMap).length === 0) && (
        <div className="gallery-overlay-status empty">
          <span>No labeled masks</span>
        </div>
      )}
    </div>
  );
}

// ============ Component ============
export function PreviewCard({ image, colorMap }: PreviewCardProps) {
  return (
    <Card className="gallery-card" variant="elevated" padding="small">
      <ImagePreview image={image} colorMap={colorMap} />
      <div className="gallery-meta">
        <div>
          <p className="gallery-title">{image.meta.fileName}</p>
          <p className="gallery-subtitle">{image.imageId}</p>
        </div>
        <span
          className={`badge badge-small badge-${
            image.meta.status === 'labeled' ? 'success' : 'default'
          }`}
        >
          {image.meta.status}
        </span>
      </div>
    </Card>
  );
}

export default PreviewCard;
