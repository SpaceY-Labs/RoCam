/**
 * LabelPopup - Shared popup component for assigning labels to masks
 * Used by LabelImage and ManagementModal
 */

import { useCallback, useEffect, useRef } from 'react';
import type { Label, LabelsMap, MaskApiItem } from '../../../types';
import './LabelPopup.css';

// ============ Types ============
export interface LabelPopupPosition {
  x: number;
  y: number;
}

export interface LabelPopupProps {
  /** Position on screen */
  position: LabelPopupPosition;
  /** Available labels */
  labels: LabelsMap;
  /** Currently selected mask */
  selectedMask: MaskApiItem | null;
  /** Whether label assignment is in progress */
  assigning?: boolean;
  /** Callback when a label is selected */
  onAssignLabel: (labelId: string | null) => void;
  /** Callback to close the popup */
  onClose: () => void;
}

// ============ Icons ============
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

// ============ Component ============
export function LabelPopup({
  position,
  labels,
  selectedMask,
  assigning = false,
  onAssignLabel,
  onClose,
}: LabelPopupProps) {
  const popupRef = useRef<HTMLDivElement>(null);
  const hasLabels = Object.keys(labels || {}).length > 0;

  // ============ Click Outside Handler ============
  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (popupRef.current?.contains(event.target as Node)) return;
      onClose();
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [onClose]);

  // ============ Keyboard Handler ============
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // ============ Handlers ============
  const handleLabelClick = useCallback(
    (labelId: string) => {
      if (assigning) return;
      onAssignLabel(labelId);
    },
    [assigning, onAssignLabel]
  );

  const handleClearLabel = useCallback(() => {
    if (assigning) return;
    onAssignLabel(null);
  }, [assigning, onAssignLabel]);

  // ============ Render - No Labels ============
  if (!hasLabels) {
    return (
      <>
        <div
          ref={popupRef}
          className="label-popup"
          style={{ left: position.x, top: position.y }}
        >
          <div className="label-popup-header">
            <span>No labels available</span>
            <button className="label-popup-close" onClick={onClose}>
              <CloseIcon />
            </button>
          </div>
          <div className="label-popup-options">
            <span className="label-popup-hint">Create labels in the project setup.</span>
          </div>
        </div>
        <div className="label-popup-backdrop" onClick={onClose} />
      </>
    );
  }

  // ============ Render - With Labels ============
  const labelsList = Object.values(labels);

  return (
    <>
      <div
        ref={popupRef}
        className="label-popup"
        style={{ left: position.x, top: position.y }}
      >
        <div className="label-popup-header">
          <span>Assign Label</span>
          <button className="label-popup-close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="label-popup-options">
          {labelsList.map((label: Label) => {
            const isActive = selectedMask?.labelId === label.labelId;
            return (
              <button
                key={label.labelId}
                className={`label-popup-option ${isActive ? 'active' : ''}`}
                onClick={() => handleLabelClick(label.labelId)}
                disabled={assigning}
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
              disabled={assigning}
            >
              <TrashIcon />
              Remove Label
            </button>
          </div>
        )}
      </div>

      <div className="label-popup-backdrop" onClick={onClose} />
    </>
  );
}

export default LabelPopup;
