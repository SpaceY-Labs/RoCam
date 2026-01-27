import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project, ProjectImage, SparseColorMap } from '../types';
import { listImages, getColorMap } from '../modules/API_Helps';
import { Button, Card, EmptyState, LoadingState } from './ui';
import './PreviewGallery.css';

const PER_PAGE_OPTIONS = [6, 12, 24, 48];
const OVERLAY_ALPHA = 130;

interface PreviewGalleryProps {
  project: Project | null;
  onSelectProject: () => void;
}

export function PreviewGallery({ project, onSelectProject }: PreviewGalleryProps) {
  const projectId = project?.projectId;
  const [images, setImages] = useState<ProjectImage[]>([]);
  const [colorMaps, setColorMaps] = useState<Record<string, SparseColorMap | null | undefined>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [perPage, setPerPage] = useState(PER_PAGE_OPTIONS[1]);
  const [total, setTotal] = useState<number | null>(null);
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([]);
  const [cursorParam, setCursorParam] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const pageIndex = cursorStack.length + 1;
  const pageCount = total ? Math.max(1, Math.ceil(total / perPage)) : null;

  const resetPaging = () => {
    setCursorStack([]);
    setCursorParam(null);
    setNextCursor(null);
    setTotal(null);
  };

  const loadPage = useCallback(
    async (cursor: string | null) => {
      if (!projectId) return;
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setLoading(true);
      setError(null);
      setCursorParam(cursor);

      try {
        const response = await listImages(projectId, {
          limit: perPage,
          cursor: cursor || undefined,
          includeTotal: !cursor,
          includeFileUrl: true,
        });

        if (requestIdRef.current !== requestId) {
          return;
        }

        const items = (response.items || []).map((item) => ({
          imageId: item.imageId,
          projectId: projectId,
          maskMapId: item.maskMapId || null,
          labelComplete: item.labelComplete || false,
          reviewed: item.reviewed || false,
          meta: {
            fileName: item.meta?.fileName || 'Unknown',
            width: item.meta?.width || 0,
            height: item.meta?.height || 0,
            status: item.meta?.status || 'unlabeled',
            tags: item.meta?.tags || [],
          },
          fileUrl: item.fileUrl,
          createdAt: item.createdAt || new Date().toISOString(),
        }));

        setImages(items);
        setNextCursor(response.cursor || null);
        if (!cursor && typeof response.total === 'number') {
          setTotal(response.total);
        }

        const overlaySeed: Record<string, SparseColorMap | null | undefined> = {};
        items.forEach((item) => {
          overlaySeed[item.imageId] = undefined;
        });
        setColorMaps(overlaySeed);

        await Promise.all(
          items.map(async (item) => {
            try {
              if (!item.maskMapId) {
                overlaySeed[item.imageId] = null;
                return;
              }
              const colorMap = await getColorMap(projectId, item.maskMapId);
              overlaySeed[item.imageId] = colorMap;
            } catch {
              overlaySeed[item.imageId] = null;
            }
          })
        );

        if (requestIdRef.current !== requestId) {
          return;
        }

        setColorMaps({ ...overlaySeed });
      } catch (err) {
        if (requestIdRef.current !== requestId) {
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load previews');
        setImages([]);
        setColorMaps({});
        setNextCursor(null);
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false);
        }
      }
    },
    [perPage, projectId]
  );

  useEffect(() => {
    if (!projectId) {
      setImages([]);
      setColorMaps({});
      resetPaging();
      return;
    }
    resetPaging();
    loadPage(null);
  }, [loadPage, projectId, perPage]);

  const handleNext = () => {
    if (!nextCursor) return;
    setCursorStack((prev) => [...prev, cursorParam]);
    loadPage(nextCursor);
  };

  const handlePrev = () => {
    if (cursorStack.length === 0) return;
    const previous = cursorStack[cursorStack.length - 1] ?? null;
    setCursorStack((prev) => prev.slice(0, -1));
    loadPage(previous);
  };

  if (!project) {
    return (
      <EmptyState
        title="Select a project"
        description="Choose a project to preview its images and labeled masks."
        action={{ label: 'Go to projects', onClick: onSelectProject }}
      />
    );
  }

  if (loading && images.length === 0) {
    return <LoadingState message="Loading image previews..." />;
  }

  return (
    <div className="gallery">
      <div className="gallery-toolbar">
        <div>
          <p className="eyebrow">Preview Panel</p>
          <h2>Image + Labeled Masks</h2>
          <p className="muted small">
            {total !== null ? `${total} total images` : 'All available images'}
          </p>
        </div>
        <div className="gallery-controls">
          <label className="gallery-label">
            Per page
            <select
              value={perPage}
              onChange={(event) => setPerPage(Number(event.target.value))}
            >
              {PER_PAGE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <div className="gallery-pagination">
            <Button variant="ghost" onClick={handlePrev} disabled={cursorStack.length === 0}>
              Prev
            </Button>
            <span className="gallery-page">
              Page {pageIndex}
              {pageCount ? ` of ${pageCount}` : ''}
            </span>
            <Button variant="ghost" onClick={handleNext} disabled={!nextCursor}>
              Next
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="banner error">
          <span>{error}</span>
          <button className="btn btn-ghost btn-small" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {loading && images.length > 0 && (
        <div className="gallery-loading-row">
          <div className="loading-spinner" />
          <span>Refreshing previews...</span>
        </div>
      )}

      {images.length === 0 ? (
        <EmptyState
          title="No images found"
          description="Upload images to start reviewing labeled masks."
        />
      ) : (
        <div className="gallery-grid">
          {images.map((image) => (
            <PreviewCard
              key={image.imageId}
              image={image}
              colorMap={colorMaps[image.imageId]}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PreviewCard({
  image,
  colorMap,
}: {
  image: ProjectImage;
  colorMap: SparseColorMap | null | undefined;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colorCache = useMemo(() => new Map<string, [number, number, number]>(), []);

  const drawOverlay = useCallback(() => {
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
      if (!Number.isFinite(row)) continue;
      if (row < 0 || row >= srcHeight) continue;
      const destY = Math.floor((row / srcHeight) * height);
      const destRow = destY * width * 4;

      for (const [colKey, hexColor] of Object.entries(cols)) {
        const col = Number(colKey);
        if (!Number.isFinite(col)) continue;
        if (col < 0 || col >= srcWidth) continue;
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
  }, [colorCache, colorMap, image.meta.height, image.meta.width]);

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
    <Card className="gallery-card" variant="elevated" padding="small">
      <div
        className="gallery-thumb"
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
      <div className="gallery-meta">
        <div>
          <p className="gallery-title">{image.meta.fileName}</p>
          <p className="gallery-subtitle">{image.imageId}</p>
        </div>
        <span className={`badge badge-small badge-${image.meta.status === 'labeled' ? 'success' : 'default'}`}>
          {image.meta.status}
        </span>
      </div>
    </Card>
  );
}
