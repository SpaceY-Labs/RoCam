import { useState, useRef, useEffect, useCallback } from 'react';
import type { SparseColorMap, MaskOverlay, MaskApiItem } from '../types';
import type { InteractiveMap } from '../types/interactiveMap';
import { buildInteractiveMap } from '../utils/interactiveMapBuilder';

const DEBOUNCE_MS = 150;

export interface InteractiveMapCanvasProps {
  imageUrl: string;
  colorMap: SparseColorMap | null;
  maskOverlay: MaskOverlay | null;
  highlightedMaskId: string | null;
  masks: MaskApiItem[];
  onMaskHover: (maskId: string | null) => void;
  onMaskClick: (maskId: string, clientX: number, clientY: number) => void;
  className?: string;
  imageAlt?: string;
  cursor?: string;
}

export function InteractiveMapCanvas({
  imageUrl,
  colorMap,
  maskOverlay,
  highlightedMaskId,
  masks,
  onMaskHover,
  onMaskClick,
  className,
  imageAlt = 'Labeling target',
  cursor = 'crosshair',
}: InteractiveMapCanvasProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const rebuildTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [interactiveMap, setInteractiveMap] = useState<InteractiveMap | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);

  useEffect(() => {
    if (rebuildTimeoutRef.current) {
      clearTimeout(rebuildTimeoutRef.current);
    }

    rebuildTimeoutRef.current = setTimeout(() => {
      const img = imageRef.current;
      const wrapper = wrapperRef.current;

      if (!img || !wrapper || !img.complete) return;

      const map = buildInteractiveMap(
        img,
        wrapper,
        colorMap,
        maskOverlay,
        highlightedMaskId,
        masks
      );

      setInteractiveMap(map);
    }, DEBOUNCE_MS);

    return () => {
      if (rebuildTimeoutRef.current) {
        clearTimeout(rebuildTimeoutRef.current);
      }
    };
  }, [
    imageUrl,
    imageLoaded,
    colorMap,
    maskOverlay,
    highlightedMaskId,
    masks,
  ]);

  useEffect(() => {
    if (!interactiveMap || !displayCanvasRef.current) return;
    const d = displayCanvasRef.current;
    d.width = interactiveMap.canvas.width;
    d.height = interactiveMap.canvas.height;
    const ctx = d.getContext('2d');
    if (ctx) {
      ctx.drawImage(interactiveMap.canvas, 0, 0);
    }
  }, [interactiveMap]);

  const handleImageLoad = useCallback(() => {
    setImageLoaded(true);
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!interactiveMap || !imageRef.current) return;

      const imageRect = imageRef.current.getBoundingClientRect();
      const maskId = interactiveMap.getMaskAtPosition(
        e.clientX,
        e.clientY,
        imageRect
      );

      onMaskHover(maskId);
    },
    [interactiveMap, onMaskHover]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!interactiveMap || !imageRef.current) return;

      const imageRect = imageRef.current.getBoundingClientRect();
      const maskId = interactiveMap.getMaskAtPosition(
        e.clientX,
        e.clientY,
        imageRect
      );

      if (maskId) {
        onMaskClick(maskId, e.clientX, e.clientY);
      }
    },
    [interactiveMap, onMaskClick]
  );

  const handleMouseLeave = useCallback(() => {
    onMaskHover(null);
  }, [onMaskHover]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
    }
  }, []);

  return (
    <div
      ref={wrapperRef}
      className={className}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      onWheel={handleWheel}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        cursor: maskOverlay ? cursor : 'default',
      }}
    >
      <img
        ref={imageRef}
        src={imageUrl}
        alt={imageAlt}
        onLoad={handleImageLoad}
        draggable={false}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          objectFit: 'contain',
        }}
      />

      {interactiveMap && (
        <canvas
          ref={displayCanvasRef}
          width={interactiveMap.canvas.width}
          height={interactiveMap.canvas.height}
          style={{
            position: 'absolute',
            left: `${interactiveMap.coordinates.offsetX}px`,
            top: `${interactiveMap.coordinates.offsetY}px`,
            width: `${interactiveMap.coordinates.displayWidth}px`,
            height: `${interactiveMap.coordinates.displayHeight}px`,
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}
