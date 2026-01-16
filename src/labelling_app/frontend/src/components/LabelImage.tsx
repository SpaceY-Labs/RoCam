import { useState, useRef, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import type { Project, ProjectImage, BoundingBox } from '../types';
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
  onNavigate: (direction: 'prev' | 'next') => void;
  loading: boolean;
}

export function LabelImage({
  project,
  images,
  onSelectProject,
  onSaveAnnotations,
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
        onNavigate={handleNavigate}
        loading={loading}
      />
    </div>
  );
}

function LabelImageContent({
  project,
  currentImage,
  imagesCount,
  currentIndex,
  activeClassId,
  onSelectClass,
  onSaveAnnotations,
  onNavigate,
  loading,
}: LabelImageContentProps) {
  const [boxes, setBoxes] = useState<BoundingBox[]>([]);
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
