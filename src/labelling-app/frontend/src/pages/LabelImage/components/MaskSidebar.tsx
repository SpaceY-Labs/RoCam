/**
 * MaskSidebar - Sidebar displaying mask information and list
 * Shows current image info, mask stats, and clickable mask list
 */

import type { MaskApiItem, Project, ProjectImage } from '../../../types';
import { Card, StatusBadge } from '../../../components/ui';

// ============ Constants ============
const UNLABELED_COLOR = '#3B82F6';

// ============ Types ============
export interface MaskSidebarProps {
  /** Current project */
  project: Project;
  /** Current image */
  currentImage: ProjectImage | null;
  /** List of masks */
  masks: MaskApiItem[];
  /** Currently selected mask ID */
  selectedMaskId: string | null;
  /** Currently highlighted mask ID (from hover) */
  highlightedMaskId: string | null;
  /** Callback when mask is clicked */
  onMaskClick: (mask: MaskApiItem, event: React.MouseEvent) => void;
}

// ============ Component ============
export function MaskSidebar({
  project,
  currentImage,
  masks,
  selectedMaskId,
  highlightedMaskId,
  onMaskClick,
}: MaskSidebarProps) {
  const labeledCount = masks.filter((m) => m.labelId !== null).length;
  const unlabeledCount = masks.length - labeledCount;

  return (
    <div className="label-sidebar">
      {/* Image Info */}
      <Card variant="bordered" padding="medium" className="image-info-card">
        <h4>Current Image</h4>
        <div className="info-row">
          <span className="info-label">File</span>
          <span className="info-value">{currentImage?.meta.fileName || 'None'}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Status</span>
          <StatusBadge status={currentImage?.meta.status || 'unlabeled'} />
        </div>
        <div className="info-row">
          <span className="info-label">Dimensions</span>
          <span className="info-value">
            {currentImage?.meta.width || 0} x {currentImage?.meta.height || 0}
          </span>
        </div>
      </Card>

      {/* Mask Info */}
      <Card variant="bordered" padding="medium" className="mask-info-card">
        <h4>Masks ({masks.length})</h4>
        <div className="info-row">
          <span className="info-label">Labeled</span>
          <span className="info-value">{labeledCount}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Unlabeled</span>
          <span className="info-value">{unlabeledCount}</span>
        </div>
        <p className="mask-hint">Hover over image to reveal masks. Click to label.</p>

        {/* Masks List */}
        {masks.length > 0 && (
          <div className="masks-list">
            {masks.map((mask, index) => {
              const label = mask.labelId ? project.labels[mask.labelId] : null;
              const isSelected = selectedMaskId === mask.maskId;
              const isHighlighted = highlightedMaskId === mask.maskId;

              return (
                <button
                  key={mask.maskId}
                  className={`mask-list-item ${isSelected ? 'selected' : ''} ${
                    isHighlighted ? 'highlighted' : ''
                  }`}
                  onClick={(e) => onMaskClick(mask, e)}
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
                <span className="label-color" style={{ backgroundColor: label.color }} />
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
  );
}

export default MaskSidebar;
