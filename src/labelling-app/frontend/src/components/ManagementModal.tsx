import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ImageStatus,
  MaskApiItem,
  MaskMapApiItem,
  MaskOverlay,
  Project,
  ProjectImage,
  SamPoint,
  SparseColorMap,
} from '../types';
import {
  batchUpdateMaskLabels,
  getColorMap,
  getImageMaskOverlay,
  getImageMasks,
  importSamMasks,
  requestSamMasks,
  updateImage,
} from '../modules/API_Helps';
import { Button, Input, Select, StatusBadge, TagBadge, ErrorBoundary } from './ui';
import { InteractiveMapOverlay, useMaskHover } from './shared';
import './ui/ErrorBoundary.css';
import './ManagementModal.css';

const STATUS_OPTIONS = [
  { value: 'unlabeled', label: 'Unlabeled' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'labeled', label: 'Labeled' },
];

const HOVER_DELAY_MS = 0;
const UNLABELED_COLOR = '#3B82F6';

interface LabelPopupState {
  maskId: string;
  x: number;
  y: number;
}

interface ManagementModalProps {
  project: Project;
  image: ProjectImage;
  colorMap: SparseColorMap | null | undefined;
  onClose: () => void;
  onPrevImage?: () => void;
  onNextImage?: () => void;
  hasPrevImage?: boolean;
  hasNextImage?: boolean;
  onImageUpdated: (
    imageId: string,
    updates: {
      meta?: {
        status?: ImageStatus;
        tags?: string[];
      };
      labelComplete?: boolean;
      reviewed?: boolean;
    }
  ) => void;
  onColorMapUpdated: (imageId: string, colorMap: SparseColorMap | null) => void;
}

export function ManagementModal({
  project,
  image,
  colorMap,
  onClose,
  onPrevImage,
  onNextImage,
  hasPrevImage,
  hasNextImage,
  onImageUpdated,
  onColorMapUpdated,
}: ManagementModalProps) {
  const projectId = project.projectId;
  const [editStatus, setEditStatus] = useState<ImageStatus>(image.meta.status);
  const [editTags, setEditTags] = useState<string[]>(image.meta.tags ? [...image.meta.tags] : []);
  const [tagInput, setTagInput] = useState('');
  const [editLabelComplete, setEditLabelComplete] = useState(Boolean(image.labelComplete));
  const [editReviewed, setEditReviewed] = useState(Boolean(image.reviewed));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [masks, setMasks] = useState<MaskApiItem[]>([]);
  const [maskMap, setMaskMap] = useState<MaskMapApiItem | null>(null);
  const [maskOverlay, setMaskOverlay] = useState<MaskOverlay | null>(null);
  const [maskLoading, setMaskLoading] = useState(false);
  const [maskError, setMaskError] = useState<string | null>(null);
  const [labelError, setLabelError] = useState<string | null>(null);

  const [selectedMaskId, setSelectedMaskId] = useState<string | null>(null);
  const [focusedMaskIds, setFocusedMaskIds] = useState<string[]>([]);
  const [labelPopup, setLabelPopup] = useState<LabelPopupState | null>(null);
  const [labelAssigning, setLabelAssigning] = useState(false);
  const [activeColorMap, setActiveColorMap] = useState<SparseColorMap | null | undefined>(colorMap);

  // SAM point tool state
  const [samToolActive, setSamToolActive] = useState(false);
  const [samPoints, setSamPoints] = useState<SamPoint[]>([]);
  const [samLoading, setSamLoading] = useState(false);
  const [samError, setSamError] = useState<string | null>(null);

  const labelPopupRef = useRef<HTMLDivElement>(null);
  const masksRequestIdRef = useRef(0);
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imageIdRef = useRef(image.imageId);
  const latestPayloadRef = useRef({
    status: editStatus,
    tags: editTags,
    labelComplete: editLabelComplete,
    reviewed: editReviewed,
  });
  const DEBOUNCE_MS = 450;

  const {
    highlightedMaskId,
    handleMouseMove: onOverlayMouseMove,
    handleMouseLeave: onOverlayMouseLeave,
    reset: resetHover,
  } = useMaskHover({ hoverDelay: HOVER_DELAY_MS });

  useEffect(() => {
    setEditStatus(image.meta.status);
    setEditTags(image.meta.tags ? [...image.meta.tags] : []);
    setTagInput('');
    setEditLabelComplete(Boolean(image.labelComplete));
    setEditReviewed(Boolean(image.reviewed));
    setSaveError(null);
    setMaskError(null);
    setLabelError(null);
    setSelectedMaskId(null);
    setFocusedMaskIds([]);
    setLabelPopup(null);
    resetHover();
    setSamToolActive(false);
    setSamPoints([]);
    setSamError(null);
  }, [image.imageId, image.labelComplete, image.meta.status, image.meta.tags, image.reviewed, resetHover]);

  useEffect(() => {
    setActiveColorMap(colorMap);
  }, [colorMap, image.imageId]);

  useEffect(() => {
    let isActive = true;
    const requestId = masksRequestIdRef.current + 1;
    masksRequestIdRef.current = requestId;

    const loadMasks = async () => {
      setMaskLoading(true);
      setMaskError(null);
      setMasks([]);
      setMaskMap(null);
      setMaskOverlay(null);

      try {
        const [maskResult, overlay] = await Promise.all([
          getImageMasks(projectId, image.imageId),
          getImageMaskOverlay(projectId, image.imageId),
        ]);

        if (!isActive || masksRequestIdRef.current !== requestId) {
          return;
        }

        setMasks(maskResult.masks);
        setMaskMap(maskResult.maskMap);
        setMaskOverlay(overlay);

        if (maskResult.maskMap) {
          try {
            const fetchedColorMap = await getColorMap(projectId, maskResult.maskMap.maskMapId);
            if (!isActive || masksRequestIdRef.current !== requestId) {
              return;
            }
            setActiveColorMap(fetchedColorMap);
            onColorMapUpdated(image.imageId, fetchedColorMap);
          } catch {
            if (!isActive || masksRequestIdRef.current !== requestId) {
              return;
            }
            setActiveColorMap(null);
            onColorMapUpdated(image.imageId, null);
          }
        } else {
          setActiveColorMap(null);
          onColorMapUpdated(image.imageId, null);
        }
      } catch (err) {
        if (!isActive || masksRequestIdRef.current !== requestId) {
          return;
        }
        setMaskError(err instanceof Error ? err.message : 'Failed to load masks');
        setMasks([]);
        setMaskMap(null);
        setMaskOverlay(null);
      } finally {
        if (isActive && masksRequestIdRef.current === requestId) {
          setMaskLoading(false);
        }
      }
    };

    loadMasks();

    return () => {
      isActive = false;
    };
  }, [image.imageId, onColorMapUpdated, projectId]);

  useEffect(() => {
    if (!labelPopup) {
      return;
    }

    const handleOutsideClick = (event: MouseEvent) => {
      if (labelPopupRef.current?.contains(event.target as Node)) {
        return;
      }
      setLabelPopup(null);
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [labelPopup]);

  const performSave = useCallback(
    async (
      pid: string,
      iid: string,
      payload: {
        status: ImageStatus;
        tags: string[];
        labelComplete: boolean;
        reviewed: boolean;
      }
    ) => {
      setSaving(true);
      setSaveError(null);
      try {
        await updateImage(pid, iid, {
          meta: { status: payload.status, tags: payload.tags },
          labelComplete: payload.labelComplete,
          reviewed: payload.reviewed,
        });
        onImageUpdated(iid, {
          meta: { status: payload.status, tags: payload.tags },
          labelComplete: payload.labelComplete,
          reviewed: payload.reviewed,
        });
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Failed to save changes');
      } finally {
        setSaving(false);
      }
    },
    [onImageUpdated]
  );

  useEffect(() => {
    imageIdRef.current = image.imageId;
    latestPayloadRef.current = {
      status: editStatus,
      tags: editTags,
      labelComplete: editLabelComplete,
      reviewed: editReviewed,
    };

    const tagsEqual =
      editTags.length === (image.meta.tags?.length ?? 0) &&
      editTags.every((t, i) => image.meta.tags?.[i] === t);
    const unchanged =
      editStatus === image.meta.status &&
      tagsEqual &&
      editLabelComplete === Boolean(image.labelComplete) &&
      editReviewed === Boolean(image.reviewed);
    if (unchanged) {
      if (saveDebounceRef.current) {
        clearTimeout(saveDebounceRef.current);
        saveDebounceRef.current = null;
      }
      return;
    }

    saveDebounceRef.current = setTimeout(() => {
      saveDebounceRef.current = null;
      const payload = latestPayloadRef.current;
      performSave(projectId, imageIdRef.current, payload);
    }, DEBOUNCE_MS);

    return () => {
      if (saveDebounceRef.current) {
        clearTimeout(saveDebounceRef.current);
        saveDebounceRef.current = null;
      }
    };
  }, [
    editStatus,
    editTags,
    editLabelComplete,
    editReviewed,
    image.imageId,
    image.meta.status,
    image.meta.tags,
    image.labelComplete,
    image.reviewed,
    projectId,
    performSave,
  ]);

  const handleAddTag = () => {
    const trimmed = tagInput.trim().toLowerCase();
    if (trimmed && !editTags.includes(trimmed)) {
      setEditTags((prev) => [...prev, trimmed]);
    }
    setTagInput('');
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setEditTags((prev) => prev.filter((tag) => tag !== tagToRemove));
  };

  const handleTagKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleAddTag();
    }
  };

  const handleRetrySave = useCallback(() => {
    performSave(projectId, image.imageId, {
      status: editStatus,
      tags: editTags,
      labelComplete: editLabelComplete,
      reviewed: editReviewed,
    });
  }, [projectId, image.imageId, editStatus, editTags, editLabelComplete, editReviewed, performSave]);

  const highlightedMask = highlightedMaskId
    ? masks.find((mask) => mask.maskId === highlightedMaskId) || null
    : null;

  const selectedMask = selectedMaskId
    ? masks.find((mask) => mask.maskId === selectedMaskId) || null
    : null;

  const handleOverlayMouseMove = useCallback(
    (maskId: string | null, _event: React.MouseEvent) => {
      onOverlayMouseMove(maskId);
    },
    [onOverlayMouseMove]
  );

  const handleOverlayClick = useCallback(
    (maskId: string | null, event: React.MouseEvent) => {
      if (!maskId) {
        // Clicked empty area -> exit selection mode
        setFocusedMaskIds([]);
        return;
      }

      if (focusedMaskIds.includes(maskId)) {
        // Clicked on an already-selected mask -> open label popup
        setSelectedMaskId(maskId);
        setLabelPopup({
          maskId,
          x: event.clientX,
          y: event.clientY + 12,
        });
      } else {
        // Clicked on any mask -> add to selection
        setFocusedMaskIds((prev) => [...prev, maskId]);
      }
    },
    [focusedMaskIds]
  );

  const handleMaskClick = useCallback(
    (mask: MaskApiItem, event: React.MouseEvent) => {
      event.stopPropagation();
      setFocusedMaskIds((prev) => {
        if (prev.includes(mask.maskId)) {
          // Remove from set (toggle off)
          return prev.filter((id) => id !== mask.maskId);
        }
        // Add to set
        return [...prev, mask.maskId];
      });
    },
    []
  );

  const handleClosePopup = useCallback(() => {
    setLabelPopup(null);
  }, []);

  const handleAssignLabel = useCallback(
    async (labelId: string | null) => {
      if (!labelPopup) return;
      setLabelAssigning(true);
      setLabelError(null);

      // Build the set of masks to label: all selected masks
      const maskIdsToLabel = focusedMaskIds.length > 0
        ? [...new Set([...focusedMaskIds, labelPopup.maskId])]
        : [labelPopup.maskId];

      try {
        const updates = maskIdsToLabel.map((id) => ({ maskId: id, labelId }));
        const { results } = await batchUpdateMaskLabels(projectId, updates);

        // Build a map of successful results
        const resultMap = new Map<string, { labelId: string | null; color: string | null }>();
        for (const r of results) {
          if (r.success) {
            resultMap.set(r.maskId, { labelId: r.labelId ?? null, color: r.color ?? null });
          }
        }

        setMasks((prev) =>
          prev.map((mask) => {
            const update = resultMap.get(mask.maskId);
            return update
              ? { ...mask, labelId: update.labelId, color: update.color }
              : mask;
          })
        );

        if (maskMap) {
          const updatedColorMap = await getColorMap(projectId, maskMap.maskMapId);
          setActiveColorMap(updatedColorMap);
          onColorMapUpdated(image.imageId, updatedColorMap);
        }

        // Clear selection and popup
        setLabelPopup(null);
        setFocusedMaskIds([]);
      } catch (err) {
        setLabelError(err instanceof Error ? err.message : 'Failed to update label');
      } finally {
        setLabelAssigning(false);
      }
    },
    [focusedMaskIds, image.imageId, labelPopup, maskMap, onColorMapUpdated, projectId]
  );

  const handleClearLabel = useCallback(() => {
    handleAssignLabel(null);
  }, [handleAssignLabel]);

  // ============ SAM Point Tool Handlers ============

  const handleToggleSamTool = useCallback(() => {
    setSamToolActive((prev) => {
      if (prev) {
        // Deactivating: clear points
        setSamPoints([]);
        setSamError(null);
      }
      return !prev;
    });
  }, []);

  const handleImageClick = useCallback(
    (point: { x: number; y: number }) => {
      if (!samToolActive) return;
      setSamPoints((prev) => [...prev, { x: point.x, y: point.y, label: 1 }]);
    },
    [samToolActive]
  );

  const handleClearSamPoints = useCallback(() => {
    setSamPoints([]);
    setSamError(null);
  }, []);

  /** Reload masks after import */
  const reloadMasks = useCallback(async () => {
    try {
      const [maskResult, overlay] = await Promise.all([
        getImageMasks(projectId, image.imageId),
        getImageMaskOverlay(projectId, image.imageId),
      ]);
      setMasks(maskResult.masks);
      setMaskMap(maskResult.maskMap);
      setMaskOverlay(overlay);
      if (maskResult.maskMap) {
        const fetchedColorMap = await getColorMap(projectId, maskResult.maskMap.maskMapId);
        setActiveColorMap(fetchedColorMap);
        onColorMapUpdated(image.imageId, fetchedColorMap);
      }
    } catch {
      // Non-critical: masks will refresh on next modal open
    }
  }, [image.imageId, onColorMapUpdated, projectId]);

  const handleSubmitSamPoints = useCallback(async () => {
    if (samPoints.length === 0 || !image.fileUrl) return;

    setSamLoading(true);
    setSamError(null);

    try {
      // Step 1: Request masks from SAM backend (explicit user action only)
      const samResponse = await requestSamMasks(image.fileUrl, samPoints);

      if (!samResponse.masks || samResponse.masks.length === 0) {
        setSamError('SAM returned no masks for the given points.');
        return;
      }

      // Step 2: Convert SAM response to import payload
      const importMasks: Array<{ mask: number[]; width: number; height: number }> = [];
      for (const samMask of samResponse.masks) {
        if (samMask.mask && Array.isArray(samMask.mask)) {
          const height = samMask.mask.length;
          const width = height > 0 ? (samMask.mask[0]?.length ?? 0) : 0;
          if (width > 0 && height > 0) {
            const flat: number[] = [];
            for (const row of samMask.mask) {
              for (const val of row) {
                flat.push(val > 0 ? 1 : 0);
              }
            }
            importMasks.push({ mask: flat, width, height });
          }
        }
      }

      if (importMasks.length === 0) {
        setSamError('Could not extract valid masks from SAM response.');
        return;
      }

      // Step 3: Import into labelling backend
      await importSamMasks(projectId, image.imageId, { masks: importMasks });

      // Step 4: Refresh masks and overlay
      await reloadMasks();

      // Step 5: Deactivate tool and clear points
      setSamToolActive(false);
      setSamPoints([]);
    } catch (err) {
      setSamError(err instanceof Error ? err.message : 'SAM mask generation failed');
    } finally {
      setSamLoading(false);
    }
  }, [samPoints, image.fileUrl, image.imageId, projectId, reloadMasks]);

  const labeledCount = masks.filter((mask) => mask.labelId !== null).length;
  const unlabeledCount = Math.max(masks.length - labeledCount, 0);
  const hasLabels = Object.keys(project.labels || {}).length > 0;
  const hasMaskData = masks.length > 0 || Boolean(maskOverlay && maskOverlay.maskIds.length > 0);

  const showNavArrows = (hasPrevImage || hasNextImage) && (onPrevImage || onNextImage);

  return (
    <div className="management-modal-wrapper">
      {showNavArrows && hasPrevImage && onPrevImage && (
        <button
          type="button"
          className="management-nav-arrow management-nav-arrow--prev"
          onClick={onPrevImage}
          aria-label="Previous image"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      )}
      {showNavArrows && hasNextImage && onNextImage && (
        <button
          type="button"
          className="management-nav-arrow management-nav-arrow--next"
          onClick={onNextImage}
          aria-label="Next image"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      )}
    <div className="management-modal">
      <div className="management-header">
        <div>
          <p className="eyebrow">Image Management</p>
          <h3>{image.meta.fileName}</h3>
          <p className="muted small">{image.imageId}</p>
        </div>
        <StatusBadge status={editStatus} />
      </div>

      <div className="management-body">
        <div className="management-preview">
          <ErrorBoundary
            fallback={(error, reset) => (
              <div className="error-boundary-fallback" style={{ aspectRatio: image.meta.width && image.meta.height ? `${image.meta.width} / ${image.meta.height}` : '1 / 1' }}>
                <div className="error-boundary-content">
                  <h4>Failed to render image overlay</h4>
                  <p className="muted small">{error.message}</p>
                  <button className="btn btn-ghost btn-small" onClick={reset}>
                    Try again
                  </button>
                </div>
              </div>
            )}
          >
          <InteractiveMapOverlay
            className="management-canvas"
            imageUrl={image.fileUrl}
            imageAlt={image.meta.fileName}
            imageWidth={image.meta.width}
            imageHeight={image.meta.height}
            colorMap={activeColorMap}
            maskOverlay={maskOverlay}
            highlightedMaskId={highlightedMaskId}
            highlightColor={highlightedMask?.color ?? UNLABELED_COLOR}
            focusedMaskIds={focusedMaskIds}
            masks={masks}
            interactive={Boolean(maskOverlay) && !samToolActive}
            onMouseMove={handleOverlayMouseMove}
            onMouseLeave={onOverlayMouseLeave}
            onClick={samToolActive ? undefined : handleOverlayClick}
            onImageClick={samToolActive ? handleImageClick : undefined}
            overlayDots={samToolActive ? samPoints.map((p) => ({ x: p.x, y: p.y, color: '#ff4444' })) : []}
            maskLoading={maskLoading}
            statusContent={
              <>
                {samLoading && (
                  <div className="interactive-map-overlay-status">
                    <div className="loading-spinner" />
                    <span>Generating masks...</span>
                  </div>
                )}
                {!maskLoading && !samLoading && maskOverlay && maskOverlay.maskIds.length === 0 && !samToolActive && (
                  <div className="interactive-map-overlay-status empty">
                    <span>No masks available</span>
                  </div>
                )}
                {activeColorMap === undefined && !maskLoading && hasMaskData && (
                  <div className="interactive-map-overlay-status">
                    <div className="loading-spinner" />
                    <span>Loading labels...</span>
                  </div>
                )}
                {activeColorMap !== undefined &&
                  (!activeColorMap || Object.keys(activeColorMap).length === 0) &&
                  !maskLoading &&
                  hasMaskData && (
                    <div className="interactive-map-overlay-status empty">
                      <span>No labeled masks</span>
                    </div>
                  )}
              </>
            }
          />
          </ErrorBoundary>

          <div className="management-preview-meta">
            {maskLoading && <span className="mask-loading">Loading masks...</span>}
            {!maskLoading && !samToolActive && maskOverlay && (
              <span className="management-hint">
                Click masks to select, then click a selected mask to label all selected.
              </span>
            )}
            {!maskLoading && !samToolActive && !maskOverlay && (
              <span className="management-hint">Masks are unavailable for this image.</span>
            )}
            {samToolActive && (
              <span className="management-hint">
                Click on the image to place point prompts. Then click &quot;Generate&quot; to create masks.
              </span>
            )}
            {highlightedMask && !samToolActive && (
              <span className="mask-hover-info">
                Hovering: Mask ({highlightedMask.size.toLocaleString()}px)
                {highlightedMask.labelId ? ' - Labeled' : ' - Click to label'}
              </span>
            )}
          </div>

          {/* SAM Point Tool Toolbar */}
          <div className="management-sam-toolbar">
            <Button
              type="button"
              variant={samToolActive ? 'primary' : 'secondary'}
              size="small"
              onClick={handleToggleSamTool}
              disabled={samLoading || !image.fileUrl}
            >
              {samToolActive ? 'Cancel Point Tool' : 'Add Masks by Point'}
            </Button>
            {samToolActive && (
              <>
                <span className="sam-point-count">{samPoints.length} point{samPoints.length !== 1 ? 's' : ''}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="small"
                  onClick={handleClearSamPoints}
                  disabled={samPoints.length === 0 || samLoading}
                >
                  Clear
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="small"
                  onClick={handleSubmitSamPoints}
                  disabled={samPoints.length === 0 || samLoading}
                  loading={samLoading}
                >
                  Generate
                </Button>
              </>
            )}
            {samError && (
              <span className="sam-error">{samError}</span>
            )}
          </div>
        </div>

        <div className="management-form">
          <div className="management-panel">
            <h4>Progress</h4>
            <Select
              label="Status"
              options={STATUS_OPTIONS}
              value={editStatus}
              onChange={(event) => setEditStatus(event.target.value as ImageStatus)}
            />

            <div className="management-switches">
              <label className="management-checkbox">
                <input
                  type="checkbox"
                  checked={editLabelComplete}
                  onChange={(event) => setEditLabelComplete(event.target.checked)}
                />
                Label complete
              </label>
              <label className="management-checkbox">
                <input
                  type="checkbox"
                  checked={editReviewed}
                  onChange={(event) => setEditReviewed(event.target.checked)}
                />
                Reviewed
              </label>
            </div>
          </div>

          <div className="management-panel">
            <h4>Tags</h4>
            <div className="management-tag-row">
              <Input
                placeholder="Add a tag..."
                value={tagInput}
                onChange={(event) => setTagInput(event.target.value)}
                onKeyDown={handleTagKeyDown}
              />
              <Button
                type="button"
                variant="secondary"
                size="small"
                onClick={handleAddTag}
                disabled={!tagInput.trim()}
              >
                Add
              </Button>
            </div>
            {editTags.length > 0 && (
              <div className="management-tag-list">
                {editTags.map((tag) => (
                  <TagBadge key={tag} tag={tag} onRemove={() => handleRemoveTag(tag)} />
                ))}
              </div>
            )}
          </div>

          <div className="management-panel">
            <h4>Masks</h4>
            <div className="management-mask-summary">
              <span>{masks.length} total</span>
              <span>{labeledCount} labeled</span>
              <span>{unlabeledCount} unlabeled</span>
            </div>
            {maskError && <p className="management-hint error">{maskError}</p>}
            {masks.length === 0 ? (
              <p className="management-hint">No masks detected for this image.</p>
            ) : (
              <div className="masks-list-wrap">
                <div className="masks-list">
                {masks.map((mask, index) => {
                  const label = mask.labelId ? project.labels[mask.labelId] : null;
                  const isSelected = selectedMask?.maskId === mask.maskId;
                  const isHighlighted = highlightedMaskId === mask.maskId;
                  const isFocused = focusedMaskIds.includes(mask.maskId);
                  return (
                    <button
                      key={mask.maskId}
                      className={`mask-list-item ${isSelected ? 'selected' : ''} ${
                        isHighlighted ? 'highlighted' : ''
                      } ${isFocused ? 'focused' : ''}`}
                      onClick={(event) => handleMaskClick(mask, event)}
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
              </div>
            )}
          </div>

          <div className="management-panel">
            <h4>Labels</h4>
            {!hasLabels ? (
              <p className="management-hint">No labels configured for this project.</p>
            ) : (
              <div className="management-labels-list">
                {Object.values(project.labels).map((label) => (
                  <div key={label.labelId} className="management-label-item">
                    <span
                      className="management-label-dot"
                      style={{ backgroundColor: label.color }}
                    />
                    <span className="management-label-name">{label.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {(saveError || labelError) && (
        <div className="banner error">
          <span>{saveError || labelError}</span>
          {saveError && (
            <Button variant="secondary" size="small" onClick={handleRetrySave} loading={saving}>
              Retry
            </Button>
          )}
          <button
            className="btn btn-ghost btn-small"
            onClick={() => {
              setSaveError(null);
              setLabelError(null);
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="management-actions">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>

      {labelPopup && hasLabels && (
        <div
          ref={labelPopupRef}
          className="label-popup management-label-popup"
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

      {labelPopup && !hasLabels && (
        <div
          ref={labelPopupRef}
          className="label-popup management-label-popup"
          style={{ left: labelPopup.x, top: labelPopup.y }}
        >
          <div className="label-popup-header">
            <span>No labels available</span>
            <button className="label-popup-close" onClick={handleClosePopup}>
              <CloseIcon />
            </button>
          </div>
          <div className="label-popup-options">
            <span className="management-hint">Create labels in the project setup.</span>
          </div>
        </div>
      )}
    </div>
    </div>
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
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="option-check"
    >
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
