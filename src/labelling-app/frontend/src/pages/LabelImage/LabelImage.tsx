/**
 * LabelImage - Main labeling page
 * Displays image with mask overlays for labeling
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import type { Project, ProjectImage, SparseColorMap, MaskApiItem, MaskMapApiItem, MaskOverlay } from '../../types';
import { Button, EmptyState } from '../../components/ui';
import { MaskCanvas, useMaskHover } from '../../components/shared/MaskCanvas';
import { LabelPopup, type LabelPopupPosition } from '../../components/shared/LabelPopup';
import { getImageMasks, getColorMap, getImageMaskOverlay, updateMaskLabel } from '../../modules/API_Helps';
import { ImageNavigator } from './components/ImageNavigator';
import { MaskSidebar } from './components/MaskSidebar';
import { FolderIcon, ImageIcon } from './components/Icons';
import './LabelImage.css';

// ============ Constants ============
const DISPLAY_SIZE = 1024;

// ============ Types ============
export interface LabelImageProps {
  /** Current project */
  project: Project | null;
  /** Available images */
  images: ProjectImage[];
  /** Callback to navigate to projects */
  onSelectProject: () => void;
  /** Callback when image is marked as labeled */
  onMarkLabeled: (imageId: string) => Promise<boolean>;
  /** Callback when navigating to next image */
  onNextImage: () => void;
  /** Callback when navigating to previous image */
  onPrevImage: () => void;
  /** Whether loading */
  loading?: boolean;
}

// ============ Component ============
export function LabelImage({
  project,
  images,
  onSelectProject,
  onMarkLabeled,
  onNextImage,
  onPrevImage,
  loading = false,
}: LabelImageProps) {
  // ============ State ============
  const [currentIndex, setCurrentIndex] = useState(0);
  const [scale, setScale] = useState({ x: 1, y: 1 });
  const [colorMap, setColorMap] = useState<SparseColorMap | null>(null);
  const [masks, setMasks] = useState<MaskApiItem[]>([]);
  const [maskMap, setMaskMap] = useState<MaskMapApiItem | null>(null);
  const [maskOverlay, setMaskOverlay] = useState<MaskOverlay | null>(null);
  const [maskLoading, setMaskLoading] = useState(false);

  // Selection and labeling state
  const [selectedMaskId, setSelectedMaskId] = useState<string | null>(null);
  const [labelPopup, setLabelPopup] = useState<LabelPopupPosition | null>(null);
  const [labelAssigning, setLabelAssigning] = useState(false);

  // Refs
  const imageRef = useRef<HTMLImageElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Derived state
  const currentImage = images[currentIndex] || null;
  const selectedMask = masks.find((m) => m.maskId === selectedMaskId) || null;

  // Hover state using custom hook
  const { highlightedMaskId, handleMouseMove, handleMouseLeave, reset: resetHover } = useMaskHover();

  // Get highlight color for current mask
  const highlightedMask = highlightedMaskId ? masks.find((m) => m.maskId === highlightedMaskId) : null;

  // ============ Effects ============

  // Fetch masks when image changes
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
        const [masksResult, fetchedMaskOverlay] = await Promise.all([
          getImageMasks(project.projectId, currentImage.imageId),
          getImageMaskOverlay(project.projectId, currentImage.imageId),
        ]);

        const { masks: fetchedMasks, maskMap: fetchedMaskMap } = masksResult;
        setMasks(fetchedMasks);
        setMaskMap(fetchedMaskMap);
        setMaskOverlay(fetchedMaskOverlay);

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
    resetHover();
  }, [currentImage?.imageId, resetHover]);

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
  }, [currentImage]);

  // ============ Handlers ============

  const handleNavigate = useCallback(
    (direction: 'prev' | 'next') => {
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
    },
    [images.length, onNextImage, onPrevImage]
  );

  const handleImageLoad = useCallback(() => {
    if (imageRef.current) {
      const imgWidth = imageRef.current.naturalWidth;
      const imgHeight = imageRef.current.naturalHeight;

      if (imgWidth > 0 && imgHeight > 0) {
        setScale({
          x: DISPLAY_SIZE / imgWidth,
          y: DISPLAY_SIZE / imgHeight,
        });
      } else {
        setScale({ x: 1, y: 1 });
      }
    }
  }, []);

  const handleMarkLabeled = async () => {
    if (!currentImage) return;
    const ok = await onMarkLabeled(currentImage.imageId);
    if (ok) {
      handleNavigate('next');
    }
  };

  const handleCanvasMouseMove = useCallback(
    (maskId: string | null) => {
      handleMouseMove(maskId);
    },
    [handleMouseMove]
  );

  const handleCanvasClick = useCallback(
    (maskId: string | null, event: React.MouseEvent) => {
      if (maskId) {
        setSelectedMaskId(maskId);
        setLabelPopup({
          x: event.clientX,
          y: event.clientY + 10,
        });
      }
    },
    []
  );

  const handleMaskClick = useCallback((mask: MaskApiItem, event: React.MouseEvent) => {
    event.stopPropagation();
    setSelectedMaskId(mask.maskId);
    const rect = (event.target as HTMLElement).getBoundingClientRect();
    setLabelPopup({
      x: rect.left,
      y: rect.bottom + 4,
    });
  }, []);

  const handleClosePopup = useCallback(() => {
    setLabelPopup(null);
  }, []);

  const handleAssignLabel = useCallback(
    async (labelId: string | null) => {
      if (!project || !selectedMaskId) return;

      setLabelAssigning(true);
      try {
        const result = await updateMaskLabel(project.projectId, selectedMaskId, labelId);

        setMasks((prev) =>
          prev.map((m) =>
            m.maskId === selectedMaskId ? { ...m, labelId: result.labelId, color: result.color } : m
          )
        );

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
    },
    [project, selectedMaskId, maskMap]
  );

  // ============ Empty States ============

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

  // ============ Render ============
  return (
    <div className="label-container">
      <div className="label-layout">
        {/* Main Canvas Area */}
        <div className="label-canvas-section">
          {/* Toolbar */}
          <div className="canvas-toolbar">
            <ImageNavigator
              currentIndex={currentIndex}
              totalImages={images.length}
              onPrevious={() => handleNavigate('prev')}
              onNext={() => handleNavigate('next')}
            />
            <div className="toolbar-right">
              {maskLoading && <span className="mask-loading">Loading masks...</span>}
              {highlightedMask && (
                <span className="mask-hover-info">
                  Hovering: Mask ({highlightedMask.size.toLocaleString()}px)
                  {highlightedMask.labelId ? ' - Labeled' : ' - Click to label'}
                </span>
              )}
              <Button variant="primary" size="small" onClick={handleMarkLabeled} loading={loading}>
                Mark as Labeled
              </Button>
            </div>
          </div>

          {/* Canvas */}
          <div className="canvas-container">
            {currentImage?.fileUrl ? (
              <div
                ref={wrapperRef}
                className="canvas-wrapper"
                style={{
                  transform: `scale(${scale.x}, ${scale.y})`,
                  transformOrigin: 'top left',
                }}
              >
                <img
                  ref={imageRef}
                  src={currentImage.fileUrl}
                  alt={currentImage.meta.fileName}
                  onLoad={handleImageLoad}
                  draggable={false}
                  style={{ display: 'block' }}
                />
                <MaskCanvas
                  imageUrl={currentImage.fileUrl}
                  imageAlt={currentImage.meta.fileName}
                  imageWidth={currentImage.meta.width}
                  imageHeight={currentImage.meta.height}
                  colorMap={colorMap}
                  maskOverlay={maskOverlay}
                  highlightedMaskId={highlightedMaskId}
                  highlightColor={highlightedMask?.color}
                  interactive
                  onMouseMove={handleCanvasMouseMove}
                  onMouseLeave={handleMouseLeave}
                  onClick={handleCanvasClick}
                  maskLoading={maskLoading}
                  className="label-canvas-overlay"
                />
              </div>
            ) : (
              <div className="canvas-empty">
                <ImageIcon />
                <span>No image preview</span>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <MaskSidebar
          project={project}
          currentImage={currentImage}
          masks={masks}
          selectedMaskId={selectedMaskId}
          highlightedMaskId={highlightedMaskId}
          onMaskClick={handleMaskClick}
        />
      </div>

      {/* Label Popup */}
      {labelPopup && project.labels && (
        <LabelPopup
          position={labelPopup}
          labels={project.labels}
          selectedMask={selectedMask}
          assigning={labelAssigning}
          onAssignLabel={handleAssignLabel}
          onClose={handleClosePopup}
        />
      )}
    </div>
  );
}

export default LabelImage;
