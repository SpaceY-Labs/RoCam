import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ImageStatus,
  MaskApiItem,
  MaskMapApiItem,
  MaskOverlay,
  Project,
  ProjectImage,
  SparseColorMap,
} from '../types';
import {
  getColorMap,
  getImageMaskOverlay,
  getImageMasks,
  updateImage,
  updateMaskLabel,
} from '../modules/API_Helps';
import { Button, Input, Select, StatusBadge, TagBadge } from './ui';
import './ManagementModal.css';

const STATUS_OPTIONS = [
  { value: 'unlabeled', label: 'Unlabeled' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'labeled', label: 'Labeled' },
];

const OVERLAY_ALPHA = 130;
const HIGHLIGHT_ALPHA = 255;
const HOVER_DELAY_MS = 1000;
const UNLABELED_COLOR = '#3B82F6';

interface LabelPopupState {
  maskId: string;
  x: number;
  y: number;
}

const parseHexColor = (hexColor: string, fallback: [number, number, number]): [number, number, number] => {
  const hex = hexColor.replace('#', '');
  if (hex.length < 6) {
    return fallback;
  }
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return fallback;
  }
  return [r, g, b] as [number, number, number];
};

interface ManagementModalProps {
  project: Project;
  image: ProjectImage;
  colorMap: SparseColorMap | null | undefined;
  onClose: () => void;
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
  const [hoveredMaskId, setHoveredMaskId] = useState<string | null>(null);
  const [highlightedMaskId, setHighlightedMaskId] = useState<string | null>(null);
  const [labelPopup, setLabelPopup] = useState<LabelPopupState | null>(null);
  const [labelAssigning, setLabelAssigning] = useState(false);
  const [activeColorMap, setActiveColorMap] = useState<SparseColorMap | null | undefined>(colorMap);

  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const colorCache = useMemo(() => new Map<string, [number, number, number]>(), []);
  const labelPopupRef = useRef<HTMLDivElement>(null);
  const masksRequestIdRef = useRef(0);

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
    setHoveredMaskId(null);
    setHighlightedMaskId(null);
    setLabelPopup(null);
  }, [image.imageId, image.labelComplete, image.meta.status, image.meta.tags, image.reviewed]);

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

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await updateImage(projectId, image.imageId, {
        meta: { status: editStatus, tags: editTags },
        labelComplete: editLabelComplete,
        reviewed: editReviewed,
      });

      onImageUpdated(image.imageId, {
        meta: { status: editStatus, tags: editTags },
        labelComplete: editLabelComplete,
        reviewed: editReviewed,
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const highlightedMask = highlightedMaskId
    ? masks.find((mask) => mask.maskId === highlightedMaskId) || null
    : null;

  const selectedMask = selectedMaskId
    ? masks.find((mask) => mask.maskId === selectedMaskId) || null
    : null;

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

    const hasColorMap = Boolean(activeColorMap && Object.keys(activeColorMap).length > 0);
    const hasHighlight = Boolean(highlightedMaskId && maskOverlay);
    if (!hasColorMap && !hasHighlight) {
      return;
    }

    const srcWidth = maskOverlay?.width || image.meta.width || width;
    const srcHeight = maskOverlay?.height || image.meta.height || height;
    if (!srcWidth || !srcHeight) return;

    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    if (hasColorMap && activeColorMap) {
      for (const [rowKey, cols] of Object.entries(activeColorMap)) {
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
            rgb = parseHexColor(hexColor, [59, 130, 246]);
            colorCache.set(hexColor, rgb);
          }

          data[dest] = rgb[0];
          data[dest + 1] = rgb[1];
          data[dest + 2] = rgb[2];
          data[dest + 3] = OVERLAY_ALPHA;
        }
      }
    }

    if (hasHighlight && maskOverlay && highlightedMaskId) {
      const highlightIndex = maskOverlay.maskIds.indexOf(highlightedMaskId);
      if (highlightIndex >= 0) {
        const highlightColor = highlightedMask?.color || UNLABELED_COLOR;
        const [r, g, b] = parseHexColor(highlightColor, [59, 130, 246]);
        const overlayWidth = maskOverlay.width;
        const overlayHeight = maskOverlay.height;

        for (let i = 0; i < maskOverlay.data.length; i += 1) {
          if (maskOverlay.data[i] !== highlightIndex) continue;
          const srcY = Math.floor(i / overlayWidth);
          const srcX = i - srcY * overlayWidth;
          const destX = Math.floor((srcX / overlayWidth) * width);
          const destY = Math.floor((srcY / overlayHeight) * height);
          if (destX < 0 || destX >= width || destY < 0 || destY >= height) continue;
          const dest = (destY * width + destX) * 4;
          data[dest] = r;
          data[dest + 1] = g;
          data[dest + 2] = b;
          data[dest + 3] = HIGHLIGHT_ALPHA;
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }, [
    activeColorMap,
    colorCache,
    highlightedMask,
    highlightedMaskId,
    image.meta.height,
    image.meta.width,
    maskOverlay,
  ]);

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

  const getMaskAtPosition = useCallback(
    (clientX: number, clientY: number) => {
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
      if (maskIndex === undefined || maskIndex < 0) {
        return null;
      }
      return maskOverlay.maskIds[maskIndex] ?? null;
    },
    [maskOverlay]
  );

  const handleCanvasMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!maskOverlay) return;
      const maskIdAtPosition = getMaskAtPosition(event.clientX, event.clientY);
      if (maskIdAtPosition !== hoveredMaskId) {
        setHoveredMaskId(maskIdAtPosition);

        if (hoverTimerRef.current) {
          clearTimeout(hoverTimerRef.current);
          hoverTimerRef.current = null;
        }

        if (!maskIdAtPosition) {
          setHighlightedMaskId(null);
        } else {
          hoverTimerRef.current = setTimeout(() => {
            setHighlightedMaskId(maskIdAtPosition);
          }, HOVER_DELAY_MS);
        }
      }
    },
    [getMaskAtPosition, hoveredMaskId, maskOverlay]
  );

  const handleCanvasMouseLeave = useCallback(() => {
    setHoveredMaskId(null);
    setHighlightedMaskId(null);
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
    },
    []
  );

  const handleCanvasClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!maskOverlay) return;
      const maskIdAtPosition = getMaskAtPosition(event.clientX, event.clientY);
      if (!maskIdAtPosition) return;
      setSelectedMaskId(maskIdAtPosition);
      setLabelPopup({
        maskId: maskIdAtPosition,
        x: event.clientX,
        y: event.clientY + 12,
      });
    },
    [getMaskAtPosition, maskOverlay]
  );

  const handleMaskClick = useCallback(
    (mask: MaskApiItem, event: React.MouseEvent) => {
      event.stopPropagation();
      setSelectedMaskId(mask.maskId);
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      setLabelPopup({
        maskId: mask.maskId,
        x: rect.left + rect.width / 2,
        y: rect.bottom + 8,
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

      try {
        const result = await updateMaskLabel(projectId, labelPopup.maskId, labelId);

        setMasks((prev) =>
          prev.map((mask) =>
            mask.maskId === labelPopup.maskId
              ? { ...mask, labelId: result.labelId, color: result.color }
              : mask
          )
        );

        if (maskMap) {
          const updatedColorMap = await getColorMap(projectId, maskMap.maskMapId);
          setActiveColorMap(updatedColorMap);
          onColorMapUpdated(image.imageId, updatedColorMap);
        }

        setLabelPopup(null);
      } catch (err) {
        setLabelError(err instanceof Error ? err.message : 'Failed to update label');
      } finally {
        setLabelAssigning(false);
      }
    },
    [image.imageId, labelPopup, maskMap, onColorMapUpdated, projectId]
  );

  const handleClearLabel = useCallback(() => {
    handleAssignLabel(null);
  }, [handleAssignLabel]);

  const labeledCount = masks.filter((mask) => mask.labelId !== null).length;
  const unlabeledCount = Math.max(masks.length - labeledCount, 0);
  const hasLabels = Object.keys(project.labels || {}).length > 0;
  const hasMaskData = masks.length > 0 || Boolean(maskOverlay && maskOverlay.maskIds.length > 0);

  return (
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
          <div
            className="management-canvas"
            ref={frameRef}
            style={{
              aspectRatio:
                image.meta.width && image.meta.height
                  ? `${image.meta.width} / ${image.meta.height}`
                  : '1 / 1',
              cursor: maskOverlay ? 'crosshair' : 'default',
            }}
            onMouseMove={handleCanvasMouseMove}
            onMouseLeave={handleCanvasMouseLeave}
            onClick={handleCanvasClick}
          >
            {image.fileUrl ? (
              <img src={image.fileUrl} alt={image.meta.fileName} loading="lazy" />
            ) : (
              <div className="gallery-fallback">
                <span>No image URL</span>
              </div>
            )}
            <canvas ref={canvasRef} className="management-overlay" />
            {maskLoading && (
              <div className="management-overlay-status">
                <div className="loading-spinner" />
                <span>Loading masks...</span>
              </div>
            )}
            {!maskLoading && maskOverlay && maskOverlay.maskIds.length === 0 && (
              <div className="management-overlay-status empty">
                <span>No masks available</span>
              </div>
            )}
            {activeColorMap === undefined && !maskLoading && hasMaskData && (
              <div className="management-overlay-status">
                <div className="loading-spinner" />
                <span>Loading labels...</span>
              </div>
            )}
            {activeColorMap !== undefined &&
              (!activeColorMap || Object.keys(activeColorMap).length === 0) &&
              !maskLoading &&
              hasMaskData && (
                <div className="management-overlay-status empty">
                  <span>No labeled masks</span>
                </div>
              )}
          </div>

          <div className="management-preview-meta">
            {maskLoading && <span className="mask-loading">Loading masks...</span>}
            {!maskLoading && maskOverlay && (
              <span className="management-hint">
                Hover to highlight masks. Click to assign labels.
              </span>
            )}
            {!maskLoading && !maskOverlay && (
              <span className="management-hint">Masks are unavailable for this image.</span>
            )}
            {highlightedMask && (
              <span className="mask-hover-info">
                Hovering: Mask ({highlightedMask.size.toLocaleString()}px)
                {highlightedMask.labelId ? ' - Labeled' : ' - Click to label'}
              </span>
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
              <div className="masks-list">
                {masks.map((mask, index) => {
                  const label = mask.labelId ? project.labels[mask.labelId] : null;
                  const isSelected = selectedMask?.maskId === mask.maskId;
                  const isHighlighted = highlightedMaskId === mask.maskId;
                  return (
                    <button
                      key={mask.maskId}
                      className={`mask-list-item ${isSelected ? 'selected' : ''} ${
                        isHighlighted ? 'highlighted' : ''
                      }`}
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
        <Button variant="primary" onClick={handleSave} loading={saving}>
          Save changes
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
