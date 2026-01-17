import { useState, useRef, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import type {
  Project,
  ProjectImage,
  BoundingBox,
  ImageMask,
  MaskSource,
  SegmentMask,
  SegmentResponse,
} from '../types';
import { Button, Card, StatusBadge, EmptyState } from './ui';

// Generate unique ID
const generateId = (prefix: string = 'id'): string => {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

interface LabelImageProps {
  project: Project | null;
  images: ProjectImage[];
  onSelectProject: () => void;
  onSaveAnnotations: (imageId: string, boxes: BoundingBox[]) => void;
  onSegmentImage: (
    imageId: string,
    payload: {
      mode: 'click' | 'auto' | 'semantic';
      points?: { x: number; y: number; label: 0 | 1 }[];
      prompt?: string;
    }
  ) => Promise<SegmentResponse>;
  onNextImage: () => void;
  onPrevImage: () => void;
  loading?: boolean;
}

interface DrawingState {
  isDrawing: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface LabelImageContentProps {
  project: Project;
  currentImage: ProjectImage | null;
  imagesCount: number;
  currentIndex: number;
  activeClassId: string | null;
  onSelectClass: (classId: string) => void;
  onSaveAnnotations: (imageId: string, boxes: BoundingBox[]) => void;
  onSegmentImage: (
    imageId: string,
    payload: {
      mode: 'click' | 'auto' | 'semantic';
      points?: { x: number; y: number; label: 0 | 1 }[];
      prompt?: string;
    }
  ) => Promise<SegmentResponse>;
  onNavigate: (direction: 'prev' | 'next') => void;
  loading: boolean;
}

export function LabelImage({
  project,
  images,
  onSelectProject,
  onSaveAnnotations,
  onSegmentImage,
  onNextImage,
  onPrevImage,
  loading = false,
}: LabelImageProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);

  const currentImage = images[currentIndex] || null;

  const activeClassId = project?.classes.some((cls) => cls.id === selectedClassId)
    ? selectedClassId
    : project?.classes[0]?.id ?? null;

  const handleNavigate = useCallback((direction: 'prev' | 'next') => {
    setCurrentIndex((prev) => {
      if (direction === 'prev' && prev > 0) {
        onPrevImage();
        return prev - 1;
      }
      if (direction === 'next' && prev < images.length - 1) {
        onNextImage();
        return prev + 1;
      }
      return prev;
    });
  }, [images.length, onNextImage, onPrevImage]);

  if (!project) {
    return (
      <div className="label-container">
        <EmptyState
          icon={<FolderIcon />}
          title="No project selected"
          description="Select a project to start labeling images."
          action={{ label: 'Go to Projects', onClick: onSelectProject }}
        />
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div className="label-container">
        <EmptyState
          icon={<ImageIcon />}
          title="No images to label"
          description="Upload images to this project to start labeling."
        />
      </div>
    );
  }

  return (
    <div className="label-container">
      <LabelImageContent
        key={currentImage?.imageId || 'empty'}
        project={project}
        currentImage={currentImage}
        imagesCount={images.length}
        currentIndex={currentIndex}
        activeClassId={activeClassId}
        onSelectClass={setSelectedClassId}
        onSaveAnnotations={onSaveAnnotations}
        onSegmentImage={onSegmentImage}
        onNavigate={handleNavigate}
        loading={loading}
      />
    </div>
  );
}

const getBoundsFromPolygon = (polygon: ImageMask['polygon']) => {
  const points = polygon.flat();
  if (points.length === 0) {
    return null;
  }
  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
};

const masksToBoxes = (masks: ImageMask[] = []): BoundingBox[] =>
  masks
    .map((mask) => {
      const bounds = getBoundsFromPolygon(mask.polygon);
      if (!bounds || bounds.width === 0 || bounds.height === 0) {
        return null;
      }
      return {
        id: mask.id,
        classId: mask.classId,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        source: mask.source,
      };
    })
    .filter((box): box is BoundingBox => Boolean(box));

const segmentMaskToBox = (
  mask: SegmentMask,
  classId: string,
  source: MaskSource
): BoundingBox | null => {
  const bounds = mask.boundingBox
    ? {
        x: mask.boundingBox.x,
        y: mask.boundingBox.y,
        width: mask.boundingBox.w,
        height: mask.boundingBox.h,
      }
    : mask.polygon
      ? getBoundsFromPolygon(mask.polygon)
      : null;

  if (!bounds || bounds.width === 0 || bounds.height === 0) {
    return null;
  }

  return {
    id: generateId('box'),
    classId,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    source,
  };
};

function LabelImageContent({
  project,
  currentImage,
  imagesCount,
  currentIndex,
  activeClassId,
  onSelectClass,
  onSaveAnnotations,
  onSegmentImage,
  onNavigate,
  loading,
}: LabelImageContentProps) {
  const [boxes, setBoxes] = useState<BoundingBox[]>(() =>
    masksToBoxes(currentImage?.masks || [])
  );
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<DrawingState>({
    isDrawing: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
  });
  const [imageLoaded, setImageLoaded] = useState(false);
  const [scale, setScale] = useState(1);
  const [segmentPoint, setSegmentPoint] = useState({
    x: 0.5,
    y: 0.5,
    label: 1 as 0 | 1,
  });
  const [segmentPrompt, setSegmentPrompt] = useState('');
  const [segmentError, setSegmentError] = useState<string | null>(null);
  const [segmentLoading, setSegmentLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // Calculate scale when image loads
  const handleImageLoad = useCallback(() => {
    if (imageRef.current && containerRef.current) {
      const containerWidth = containerRef.current.clientWidth;
      const containerHeight = containerRef.current.clientHeight - 60;
      const imgWidth = imageRef.current.naturalWidth;
      const imgHeight = imageRef.current.naturalHeight;

      const scaleX = containerWidth / imgWidth;
      const scaleY = containerHeight / imgHeight;
      setScale(Math.min(scaleX, scaleY, 1));
    }
    setImageLoaded(true);
  }, []);

  const getRelativeCoords = (e: React.MouseEvent): { x: number; y: number } | null => {
    if (!imageRef.current) return null;

    const rect = imageRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;

    return { x, y };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!activeClassId || !imageLoaded) return;

    const coords = getRelativeCoords(e);
    if (!coords) return;

    setDrawing({
      isDrawing: true,
      startX: coords.x,
      startY: coords.y,
      currentX: coords.x,
      currentY: coords.y,
    });
    setSelectedBoxId(null);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!drawing.isDrawing) return;

    const coords = getRelativeCoords(e);
    if (!coords) return;

    setDrawing(prev => ({
      ...prev,
      currentX: coords.x,
      currentY: coords.y,
    }));
  };

  const handleMouseUp = () => {
    if (!drawing.isDrawing || !activeClassId) return;

    const minX = Math.min(drawing.startX, drawing.currentX);
    const minY = Math.min(drawing.startY, drawing.currentY);
    const width = Math.abs(drawing.currentX - drawing.startX);
    const height = Math.abs(drawing.currentY - drawing.startY);

    // Only create box if it has minimum size
    if (width > 10 && height > 10) {
      const newBox: BoundingBox = {
        id: generateId('box'),
        classId: activeClassId,
        x: minX,
        y: minY,
        width,
        height,
      };
      setBoxes(prev => [...prev, newBox]);
      setSelectedBoxId(newBox.id);
    }

    setDrawing({
      isDrawing: false,
      startX: 0,
      startY: 0,
      currentX: 0,
      currentY: 0,
    });
  };

  const handleDeleteBox = useCallback((boxId: string) => {
    setBoxes(prev => prev.filter(b => b.id !== boxId));
    setSelectedBoxId(prev => (prev === boxId ? null : prev));
  }, []);

  const handleDeleteSelected = useCallback(() => {
    if (selectedBoxId) {
      handleDeleteBox(selectedBoxId);
    }
  }, [handleDeleteBox, selectedBoxId]);

  const handleClearAll = useCallback(() => {
    setBoxes([]);
    setSelectedBoxId(null);
  }, []);

  const handleSave = () => {
    if (currentImage) {
      onSaveAnnotations(currentImage.imageId, boxes);
    }
  };

  const handleSegmentPoint = async () => {
    if (!currentImage) {
      return;
    }
    if (!activeClassId) {
      setSegmentError('Select a class before segmenting.');
      return;
    }

    if (
      Number.isNaN(segmentPoint.x) ||
      Number.isNaN(segmentPoint.y) ||
      segmentPoint.x < 0 ||
      segmentPoint.x > 1 ||
      segmentPoint.y < 0 ||
      segmentPoint.y > 1
    ) {
      setSegmentError('Point coordinates must be between 0 and 1.');
      return;
    }

    setSegmentError(null);
    setSegmentLoading(true);
    try {
      const response = await onSegmentImage(currentImage.imageId, {
        mode: 'click',
        points: [{ x: segmentPoint.x, y: segmentPoint.y, label: segmentPoint.label }],
      });
      const newBoxes = (response.masks || [])
        .map((mask) => segmentMaskToBox(mask, activeClassId, 'sam3_click'))
        .filter((box): box is BoundingBox => Boolean(box));
      if (newBoxes.length > 0) {
        setBoxes((prev) => [...prev, ...newBoxes]);
      }
    } catch (error) {
      setSegmentError('Segmentation failed. Try again.');
    } finally {
      setSegmentLoading(false);
    }
  };

  const handleSegmentPrompt = async () => {
    if (!currentImage) {
      return;
    }
    if (!activeClassId) {
      setSegmentError('Select a class before segmenting.');
      return;
    }
    if (!segmentPrompt.trim()) {
      setSegmentError('Enter a prompt for semantic segmentation.');
      return;
    }

    setSegmentError(null);
    setSegmentLoading(true);
    try {
      const response = await onSegmentImage(currentImage.imageId, {
        mode: 'semantic',
        prompt: segmentPrompt.trim(),
      });
      const newBoxes = (response.masks || [])
        .map((mask) => segmentMaskToBox(mask, activeClassId, 'sam3_semantic'))
        .filter((box): box is BoundingBox => Boolean(box));
      if (newBoxes.length > 0) {
        setBoxes((prev) => [...prev, ...newBoxes]);
      }
    } catch (error) {
      setSegmentError('Segmentation failed. Try again.');
    } finally {
      setSegmentLoading(false);
    }
  };

  const getClassColor = (classId: string): string => {
    return project.classes.find(c => c.id === classId)?.color || '#F05D5E';
  };

  const getClassName = (classId: string): string => {
    return project.classes.find(c => c.id === classId)?.name || 'Unknown';
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedBoxId) {
          e.preventDefault();
          handleDeleteSelected();
        }
      }
      if (e.key === 'ArrowLeft') {
        onNavigate('prev');
      }
      if (e.key === 'ArrowRight') {
        onNavigate('next');
      }
      // Number keys for class selection
      if (e.key >= '1' && e.key <= '9') {
        const index = parseInt(e.key, 10) - 1;
        if (project.classes[index]) {
          onSelectClass(project.classes[index].id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleDeleteSelected, onNavigate, onSelectClass, project.classes, selectedBoxId]);

  const drawingBox = drawing.isDrawing ? {
    x: Math.min(drawing.startX, drawing.currentX),
    y: Math.min(drawing.startY, drawing.currentY),
    width: Math.abs(drawing.currentX - drawing.startX),
    height: Math.abs(drawing.currentY - drawing.startY),
  } : null;

  return (
    <div className="label-layout">
      {/* Main Canvas Area */}
      <div className="label-canvas-section">
        <div className="canvas-toolbar">
          <div className="toolbar-left">
            <Button
              variant="ghost"
              size="small"
              onClick={() => onNavigate('prev')}
              disabled={currentIndex === 0}
            >
              Previous
            </Button>
            <span className="image-counter">
              {currentIndex + 1} / {imagesCount}
            </span>
            <Button
              variant="ghost"
              size="small"
              onClick={() => onNavigate('next')}
              disabled={currentIndex === imagesCount - 1}
            >
              Next
            </Button>
          </div>
          <div className="toolbar-right">
            <Button
              variant="ghost"
              size="small"
              onClick={handleDeleteSelected}
              disabled={!selectedBoxId}
            >
              Delete Selected
            </Button>
            <Button
              variant="ghost"
              size="small"
              onClick={handleClearAll}
              disabled={boxes.length === 0}
            >
              Clear All
            </Button>
            <Button
              variant="primary"
              size="small"
              onClick={handleSave}
              loading={loading}
            >
              Save & Continue
            </Button>
          </div>
        </div>

        <div
          ref={containerRef}
          className="canvas-container"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {currentImage?.fileUrl ? (
            <div className="canvas-wrapper" style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
              <img
                ref={imageRef}
                src={currentImage.fileUrl}
                alt={currentImage.meta.fileName}
                onLoad={handleImageLoad}
                draggable={false}
              />

              {/* Existing boxes */}
              {imageLoaded && boxes.map(box => (
                <div
                  key={box.id}
                  className={`annotation-box ${box.id === selectedBoxId ? 'selected' : ''}`}
                  style={{
                    left: box.x,
                    top: box.y,
                    width: box.width,
                    height: box.height,
                    '--box-color': getClassColor(box.classId),
                  } as CSSProperties}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedBoxId(box.id);
                  }}
                >
                  <span className="box-label">{getClassName(box.classId)}</span>
                  <button
                    className="box-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteBox(box.id);
                    }}
                  >
                    x
                  </button>
                </div>
              ))}

              {/* Drawing preview */}
              {drawingBox && activeClassId && (
                <div
                  className="annotation-box drawing"
                  style={{
                    left: drawingBox.x,
                    top: drawingBox.y,
                    width: drawingBox.width,
                    height: drawingBox.height,
                    '--box-color': getClassColor(activeClassId),
                  } as CSSProperties}
                />
              )}
            </div>
          ) : (
            <div className="canvas-empty">
              <ImageIcon />
              <span>No image preview</span>
            </div>
          )}
        </div>
      </div>

      {/* Right Sidebar */}
      <div className="label-sidebar">
        {/* Image Info */}
        <Card variant="bordered" padding="medium" className="image-info-card">
          <h4>Current Image</h4>
          <div className="info-row">
            <span className="info-label">File</span>
            <span className="info-value">{currentImage?.meta.fileName}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Status</span>
            <StatusBadge status={currentImage?.meta.status || 'unlabeled'} />
          </div>
          <div className="info-row">
            <span className="info-label">Dimensions</span>
            <span className="info-value">
              {currentImage?.meta.width} x {currentImage?.meta.height}
            </span>
          </div>
        </Card>

        {/* Class Selection */}
        <Card variant="bordered" padding="medium" className="class-selection-card">
          <h4>Select Class</h4>
          <p className="hint">Click a class, then draw on image</p>
          <div className="class-buttons">
            {project.classes.map((cls, index) => (
              <button
                key={cls.id}
                className={`class-select-btn ${activeClassId === cls.id ? 'active' : ''}`}
                style={{ '--class-color': cls.color } as CSSProperties}
                onClick={() => onSelectClass(cls.id)}
              >
                <span className="class-dot" />
                <span className="class-name">{cls.name}</span>
                <span className="class-shortcut">{index + 1}</span>
              </button>
            ))}
          </div>
        </Card>

        <Card variant="bordered" padding="medium" className="segmentation-card">
          <h4>Segmentation</h4>
          <p className="hint">Use a point (0-1) or a prompt to segment.</p>
          <div className="segment-grid">
            <div className="segment-field">
              <label htmlFor="segment-point-x">X</label>
              <input
                id="segment-point-x"
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={segmentPoint.x}
                onChange={(e) =>
                  setSegmentPoint((prev) => ({
                    ...prev,
                    x: Number.isNaN(Number.parseFloat(e.target.value))
                      ? 0
                      : Number.parseFloat(e.target.value),
                  }))
                }
              />
            </div>
            <div className="segment-field">
              <label htmlFor="segment-point-y">Y</label>
              <input
                id="segment-point-y"
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={segmentPoint.y}
                onChange={(e) =>
                  setSegmentPoint((prev) => ({
                    ...prev,
                    y: Number.isNaN(Number.parseFloat(e.target.value))
                      ? 0
                      : Number.parseFloat(e.target.value),
                  }))
                }
              />
            </div>
            <div className="segment-field">
              <label htmlFor="segment-point-label">Label</label>
              <select
                id="segment-point-label"
                value={segmentPoint.label}
                onChange={(e) =>
                  setSegmentPoint((prev) => ({
                    ...prev,
                    label: Number(e.target.value) as 0 | 1,
                  }))
                }
              >
                <option value={1}>Foreground</option>
                <option value={0}>Background</option>
              </select>
            </div>
          </div>
          <div className="segment-actions">
            <Button
              variant="secondary"
              size="small"
              onClick={handleSegmentPoint}
              disabled={segmentLoading}
            >
              Segment from Point
            </Button>
          </div>
          <div className="segment-divider" />
          <div className="segment-field">
            <label htmlFor="segment-prompt">Prompt</label>
            <input
              id="segment-prompt"
              type="text"
              placeholder="e.g. person, vehicle"
              value={segmentPrompt}
              onChange={(e) => setSegmentPrompt(e.target.value)}
            />
          </div>
          <div className="segment-actions">
            <Button
              variant="secondary"
              size="small"
              onClick={handleSegmentPrompt}
              disabled={segmentLoading}
            >
              Segment from Prompt
            </Button>
          </div>
          {segmentError && <p className="segment-error">{segmentError}</p>}
        </Card>

        {/* Annotations List */}
        <Card variant="bordered" padding="medium" className="annotations-card">
          <h4>Annotations ({boxes.length})</h4>
          {boxes.length === 0 ? (
            <p className="muted">No annotations yet</p>
          ) : (
            <div className="annotations-list">
              {boxes.map((box, index) => (
                <div
                  key={box.id}
                  className={`annotation-item ${box.id === selectedBoxId ? 'selected' : ''}`}
                  onClick={() => setSelectedBoxId(box.id)}
                >
                  <span
                    className="annotation-color"
                    style={{ backgroundColor: getClassColor(box.classId) }}
                  />
                  <span className="annotation-name">
                    {getClassName(box.classId)} #{index + 1}
                  </span>
                  <button
                    className="annotation-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteBox(box.id);
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Keyboard Shortcuts */}
        <Card variant="bordered" padding="small" className="shortcuts-card">
          <h4>Shortcuts</h4>
          <div className="shortcuts-list">
            <div className="shortcut">
              <kbd>1-9</kbd>
              <span>Select class</span>
            </div>
            <div className="shortcut">
              <kbd>Del</kbd>
              <span>Delete selected</span>
            </div>
            <div className="shortcut">
              <kbd>Left/Right</kbd>
              <span>Navigate images</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function FolderIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}
