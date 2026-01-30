import { useState, useRef, useEffect, useCallback } from 'react';
import type { Project, ProjectImage, SparseColorMap, MaskApiItem, MaskMapApiItem, MaskOverlay } from '../types';
import { Button, Card, StatusBadge, EmptyState } from './ui';
import { getImageMasks, getColorMap, getImageMaskOverlay, updateMaskLabel } from '../modules/API_Helps';
import { InteractiveMapCanvas } from './InteractiveMapCanvas';
import './LabelImage.css';

interface LabelPopupState {
  maskId: string;
  x: number;
  y: number;
}

interface LabelImageProps {
  project: Project | null;
  images: ProjectImage[];
  onSelectProject: () => void;
  onMarkLabeled: (imageId: string) => Promise<boolean>;
  onNextImage: () => void;
  onPrevImage: () => void;
  loading?: boolean;
}

const HOVER_DELAY_MS = 1000; // 1 second delay before showing mask
const UNLABELED_COLOR = '#3B82F6'; // Blue color for unlabeled masks

export function LabelImage({
  project,
  images,
  onSelectProject,
  onMarkLabeled,
  onNextImage,
  onPrevImage,
  loading = false,
}: LabelImageProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [colorMap, setColorMap] = useState<SparseColorMap | null>(null);
  const [masks, setMasks] = useState<MaskApiItem[]>([]);
  const [maskMap, setMaskMap] = useState<MaskMapApiItem | null>(null);
  const [maskOverlay, setMaskOverlay] = useState<MaskOverlay | null>(null);
  const [maskLoading, setMaskLoading] = useState(false);

  // Mask selection and labeling state
  const [selectedMaskId, setSelectedMaskId] = useState<string | null>(null);
  const [labelPopup, setLabelPopup] = useState<LabelPopupState | null>(null);
  const [labelAssigning, setLabelAssigning] = useState(false);

  // Hover state for mask highlighting
  const [hoveredMaskId, setHoveredMaskId] = useState<string | null>(null);
  const [highlightedMaskId, setHighlightedMaskId] = useState<string | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentImage = images[currentIndex] || null;
  const selectedMask = masks.find(m => m.maskId === selectedMaskId) || null;

  // Fetch masks, colorMap, and maskOverlay when image changes
  useEffect(() => {
    const fetchMasks = async () => {
      if (!project || !currentImage) {
        setColorMap(null);
        setMasks([]);
        setMaskMap(null);
        setMaskOverlay(null);
        return;
      }

      setMaskLoading(true);
      try {
        // Fetch masks/maskMap and maskOverlay in parallel
        // Using the new image-based maskoverlay endpoint for simplicity
        const [masksResult, fetchedMaskOverlay] = await Promise.all([
          getImageMasks(project.projectId, currentImage.imageId),
          getImageMaskOverlay(project.projectId, currentImage.imageId),
        ]);

        const { masks: fetchedMasks, maskMap: fetchedMaskMap } = masksResult;
        setMasks(fetchedMasks);
        setMaskMap(fetchedMaskMap);
        setMaskOverlay(fetchedMaskOverlay);

        // Fetch colorMap separately if we have a maskMap
        if (fetchedMaskMap) {
          const fetchedColorMap = await getColorMap(project.projectId, fetchedMaskMap.maskMapId);
          setColorMap(fetchedColorMap);
        } else {
          setColorMap(null);
        }
      } catch (err) {
        console.error('Failed to fetch masks:', err);
        setColorMap(null);
        setMasks([]);
        setMaskMap(null);
        setMaskOverlay(null);
      } finally {
        setMaskLoading(false);
      }
    };

    fetchMasks();
  }, [project, currentImage?.imageId]);

  // Clear hover state when image changes
  useEffect(() => {
    setHoveredMaskId(null);
    setHighlightedMaskId(null);
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, [currentImage?.imageId]);

  const handleMaskHover = useCallback((maskId: string | null) => {
    if (maskId === hoveredMaskId) return;

    setHoveredMaskId(maskId);

    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }

    if (!maskId) {
      setHighlightedMaskId(null);
    } else {
      hoverTimerRef.current = setTimeout(() => {
        setHighlightedMaskId(maskId);
      }, HOVER_DELAY_MS);
    }
  }, [hoveredMaskId]);

  const handleMaskClick = useCallback((maskId: string, clientX: number, clientY: number) => {
    setSelectedMaskId(maskId);
    setLabelPopup({
      maskId,
      x: clientX,
      y: clientY + 10,
    });
  }, []);

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

  const handleMarkLabeled = async () => {
    if (!currentImage) return;
    const ok = await onMarkLabeled(currentImage.imageId);
    if (ok) {
      handleNavigate('next');
    }
  };

  // Handle clicking on a mask in the sidebar list
  const handleMaskListItemClick = useCallback((mask: MaskApiItem, event: React.MouseEvent) => {
    event.stopPropagation();
    setSelectedMaskId(mask.maskId);

    // Position the popup near the click
    const rect = (event.target as HTMLElement).getBoundingClientRect();
    setLabelPopup({
      maskId: mask.maskId,
      x: rect.left,
      y: rect.bottom + 4,
    });
  }, []);

  // Close popup when clicking outside
  const handleClosePopup = useCallback(() => {
    setLabelPopup(null);
  }, []);

  // Assign a label to a mask
  const handleAssignLabel = useCallback(async (labelId: string | null) => {
    if (!project || !labelPopup) return;

    setLabelAssigning(true);
    try {
      const result = await updateMaskLabel(project.projectId, labelPopup.maskId, labelId);

      // Update the mask in local state
      setMasks(prev => prev.map(m =>
        m.maskId === labelPopup.maskId
          ? { ...m, labelId: result.labelId, color: result.color }
          : m
      ));

      // Refetch colorMap to show updated overlay
      if (maskMap) {
        const updatedColorMap = await getColorMap(project.projectId, maskMap.maskMapId);
        setColorMap(updatedColorMap);
      }

      setLabelPopup(null);
    } catch (err) {
      console.error('Failed to assign label:', err);
    } finally {
      setLabelAssigning(false);
    }
  }, [project, labelPopup, maskMap]);

  // Clear label from a mask
  const handleClearLabel = useCallback(() => {
    handleAssignLabel(null);
  }, [handleAssignLabel]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        handleNavigate('prev');
      }
      if (e.key === 'ArrowRight') {
        handleNavigate('next');
      }
      if (e.key === 'Enter') {
        handleMarkLabeled();
      }
      if (e.key === 'Escape') {
        handleClosePopup();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNavigate, currentImage, handleClosePopup]);

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

  // Get the highlighted mask info for display
  const highlightedMask = highlightedMaskId ? masks.find(m => m.maskId === highlightedMaskId) : null;

  return (
    <div className="label-container">
      <div className="label-layout">
        {/* Main Canvas Area */}
        <div className="label-canvas-section">
          <div className="canvas-toolbar">
            <div className="toolbar-left">
              <Button
                variant="ghost"
                size="small"
                onClick={() => handleNavigate('prev')}
                disabled={currentIndex === 0}
              >
                Previous
              </Button>
              <span className="image-counter">
                {currentIndex + 1} / {images.length}
              </span>
              <Button
                variant="ghost"
                size="small"
                onClick={() => handleNavigate('next')}
                disabled={currentIndex === images.length - 1}
              >
                Next
              </Button>
            </div>
            <div className="toolbar-right">
              {maskLoading && <span className="mask-loading">Loading masks...</span>}
              {highlightedMask && (
                <span className="mask-hover-info">
                  Hovering: Mask ({highlightedMask.size.toLocaleString()}px)
                  {highlightedMask.labelId ? ' - Labeled' : ' - Click to label'}
                </span>
              )}
              <Button
                variant="primary"
                size="small"
                onClick={handleMarkLabeled}
                loading={loading}
              >
                Mark as Labeled
              </Button>
            </div>
          </div>

          <div className="canvas-container">
            {currentImage?.fileUrl ? (
              <InteractiveMapCanvas
                imageUrl={currentImage.fileUrl}
                colorMap={colorMap}
                maskOverlay={maskOverlay}
                highlightedMaskId={highlightedMaskId}
                masks={masks}
                onMaskHover={handleMaskHover}
                onMaskClick={handleMaskClick}
                className="canvas-wrapper"
                imageAlt={currentImage.meta.fileName}
              />
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

          {/* Mask Info */}
          <Card variant="bordered" padding="medium" className="mask-info-card">
            <h4>Masks ({masks.length})</h4>
            <div className="info-row">
              <span className="info-label">Labeled</span>
              <span className="info-value">
                {masks.filter(m => m.labelId !== null).length}
              </span>
            </div>
            <div className="info-row">
              <span className="info-label">Unlabeled</span>
              <span className="info-value">
                {masks.filter(m => m.labelId === null).length}
              </span>
            </div>
            <p className="mask-hint">
              Hover over image to reveal masks. Click to label.
            </p>
            {masks.length > 0 && (
              <div className="masks-list">
                {masks.map((mask, index) => {
                  const label = mask.labelId && project.labels[mask.labelId];
                  const isSelected = selectedMask?.maskId === mask.maskId;
                  const isHighlighted = highlightedMaskId === mask.maskId;
                  return (
                    <button
                      key={mask.maskId}
                      className={`mask-list-item ${isSelected ? 'selected' : ''} ${isHighlighted ? 'highlighted' : ''}`}
                      onClick={(e) => handleMaskListItemClick(mask, e)}
                    >
                      <span
                        className="mask-color-dot"
                        style={{
                          backgroundColor: mask.color || UNLABELED_COLOR,
                          opacity: mask.color ? 1 : 0.5,
                        }}
                      />
                      <span className="mask-name">
                        Mask {index + 1}
                        {label && <span className="mask-label-name"> - {label.name}</span>}
                      </span>
                      <span className="mask-size">{mask.size.toLocaleString()}px</span>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Labels Legend */}
          {project.labels && Object.keys(project.labels).length > 0 && (
            <Card variant="bordered" padding="medium" className="labels-card">
              <h4>Labels</h4>
              <div className="labels-list">
                {Object.values(project.labels).map((label) => (
                  <div key={label.labelId} className="label-item">
                    <span
                      className="label-color"
                      style={{ backgroundColor: label.color }}
                    />
                    <span className="label-name">{label.name}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Keyboard Shortcuts */}
          <Card variant="bordered" padding="small" className="shortcuts-card">
            <h4>Shortcuts</h4>
            <div className="shortcuts-list">
              <div className="shortcut">
                <kbd>Enter</kbd>
                <span>Mark as labeled</span>
              </div>
              <div className="shortcut">
                <kbd>Left/Right</kbd>
                <span>Navigate images</span>
              </div>
              <div className="shortcut">
                <kbd>Esc</kbd>
                <span>Close popup</span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Label Assignment Popup */}
      {labelPopup && project.labels && (
        <div
          className="label-popup"
          style={{ left: labelPopup.x, top: labelPopup.y }}
        >
          <div className="label-popup-header">
            <span>Assign Label</span>
            <button className="label-popup-close" onClick={handleClosePopup}>
              <CloseIcon />
            </button>
          </div>
          <div className="label-popup-options">
            {Object.values(project.labels).map((label) => {
              const isActive = selectedMask?.labelId === label.labelId;
              return (
                <button
                  key={label.labelId}
                  className={`label-popup-option ${isActive ? 'active' : ''}`}
                  onClick={() => handleAssignLabel(label.labelId)}
                  disabled={labelAssigning}
                >
                  <span
                    className="option-dot"
                    style={{ '--option-color': label.color } as React.CSSProperties}
                  />
                  <span className="option-name">{label.name}</span>
                  {isActive && <CheckIcon />}
                </button>
              );
            })}
          </div>
          {selectedMask?.labelId && (
            <div className="label-popup-footer">
              <button
                className="label-popup-delete"
                onClick={handleClearLabel}
                disabled={labelAssigning}
              >
                <TrashIcon />
                Remove Label
              </button>
            </div>
          )}
        </div>
      )}

      {/* Backdrop to close popup when clicking outside */}
      {labelPopup && (
        <div className="label-popup-backdrop" onClick={handleClosePopup} />
      )}
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

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="option-check">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
  );
}
