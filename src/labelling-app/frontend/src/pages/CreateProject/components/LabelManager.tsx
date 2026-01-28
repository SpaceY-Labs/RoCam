/**
 * LabelManager - Component for managing project labels
 * Handles adding, removing, and displaying label classes
 */

import { useState } from 'react';
import type { Label, LabelsMap } from '../../../types';
import { Button, Input, ColorInput, ClassBadge } from '../../../components/ui';

// ============ Constants ============
const DEFAULT_COLORS = [
  '#F05D5E',
  '#1F7A6E',
  '#F0B65C',
  '#5C7AEA',
  '#9B59B6',
  '#E67E22',
  '#2ECC71',
  '#E74C3C',
];

// ============ Types ============
export interface LabelManagerProps {
  /** Current labels map */
  labels: LabelsMap;
  /** Callback when labels change */
  onLabelsChange: (labels: LabelsMap) => void;
  /** Error message to display */
  error?: string;
  /** Callback to clear error */
  onClearError?: () => void;
}

// ============ Helpers ============

/**
 * Generate unique ID with prefix
 */
const generateId = (prefix: string = 'id'): string => {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// ============ Component ============
export function LabelManager({
  labels,
  onLabelsChange,
  error,
  onClearError,
}: LabelManagerProps) {
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState(DEFAULT_COLORS[0]);

  const labelsList = Object.values(labels);

  // ============ Handlers ============

  /**
   * Add a new label
   */
  const handleAddLabel = () => {
    if (!newLabelName.trim()) return;

    // Check for duplicate names
    const isDuplicate = labelsList.some(
      (l) => l.name.toLowerCase() === newLabelName.trim().toLowerCase()
    );
    if (isDuplicate) {
      return; // Error handled by parent via validation
    }

    const labelId = generateId('lbl');
    const newLabel: Label = {
      labelId,
      name: newLabelName.trim(),
      color: newLabelColor,
    };

    onLabelsChange({ ...labels, [labelId]: newLabel });
    setNewLabelName('');
    setNewLabelColor(DEFAULT_COLORS[(labelsList.length + 1) % DEFAULT_COLORS.length]);
    onClearError?.();
  };

  /**
   * Remove a label
   */
  const handleRemoveLabel = (labelId: string) => {
    const next = { ...labels };
    delete next[labelId];
    onLabelsChange(next);
  };

  /**
   * Handle Enter key press
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddLabel();
    }
  };

  // ============ Render ============
  return (
    <div className="form-section">
      <h3 className="form-section-title">Labels</h3>
      <p className="form-section-desc">
        Define the labels you want to use for masks. You can add more labels later.
      </p>

      {/* Labels Preview */}
      {labelsList.length > 0 && (
        <div className="classes-preview">
          {labelsList.map((label) => (
            <ClassBadge
              key={label.labelId}
              name={label.name}
              color={label.color}
              onRemove={() => handleRemoveLabel(label.labelId)}
            />
          ))}
        </div>
      )}

      {/* Add Label Row */}
      <div className="add-class-row">
        <Input
          placeholder="Label name (e.g., Car, Pedestrian)"
          value={newLabelName}
          onChange={(e) => {
            setNewLabelName(e.target.value);
            onClearError?.();
          }}
          onKeyDown={handleKeyDown}
          className="class-name-input"
        />
        <ColorInput
          value={newLabelColor}
          onChange={setNewLabelColor}
          className="class-color-input"
        />
        <Button
          type="button"
          variant="secondary"
          onClick={handleAddLabel}
          disabled={!newLabelName.trim()}
        >
          Add Label
        </Button>
      </div>

      {/* Error Message */}
      {error && <p className="form-error">{error}</p>}

      {/* Color Presets */}
      <div className="color-presets">
        <span className="preset-label">Quick colors:</span>
        {DEFAULT_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className={`color-preset ${newLabelColor === color ? 'active' : ''}`}
            style={{ backgroundColor: color }}
            onClick={() => setNewLabelColor(color)}
            aria-label={`Select color ${color}`}
          />
        ))}
      </div>
    </div>
  );
}

export default LabelManager;
