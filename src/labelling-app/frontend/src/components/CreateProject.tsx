/**
 * Author: Jianqing Liu
 * Date: 2026-01-27
 * Purpose: Form component for creating new labelling projects with label class definitions.
 */
import { useState, type ChangeEvent } from 'react';
import type { Label, LabelsMap, ProjectFormData } from '../types';
import { Button, Input, TextArea, ColorInput, ClassBadge, Card } from './ui';
import './CreateProject.css';

// Generate unique ID
const generateId = (prefix: string = 'id'): string => {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

interface CreateProjectProps {
  onSubmit: (data: ProjectFormData) => void;
  onCancel: () => void;
  loading?: boolean;
}

const DEFAULT_COLORS = [
  '#F05D5E', '#1F7A6E', '#F0B65C', '#5C7AEA',
  '#9B59B6', '#E67E22', '#2ECC71', '#E74C3C',
];

export function CreateProject({ onSubmit, onCancel, loading = false }: CreateProjectProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [labels, setLabels] = useState<LabelsMap>({});
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState(DEFAULT_COLORS[0]);
  const [errors, setErrors] = useState<{ name?: string; labels?: string }>({});

  const labelsList = Object.values(labels);

  const handleAddLabel = () => {
    if (!newLabelName.trim()) return;

    // Check for duplicate names
    if (labelsList.some(l => l.name.toLowerCase() === newLabelName.trim().toLowerCase())) {
      setErrors(prev => ({ ...prev, labels: 'Label name already exists' }));
      return;
    }

    const labelId = generateId('lbl');
    const newLabel: Label = {
      labelId,
      name: newLabelName.trim(),
      color: newLabelColor,
    };

    setLabels(prev => ({ ...prev, [labelId]: newLabel }));
    setNewLabelName('');
    setNewLabelColor(DEFAULT_COLORS[(labelsList.length + 1) % DEFAULT_COLORS.length]);
    setErrors(prev => ({ ...prev, labels: undefined }));
  };

  const handleRemoveLabel = (labelId: string) => {
    setLabels(prev => {
      const next = { ...prev };
      delete next[labelId];
      return next;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const newErrors: typeof errors = {};

    if (!name.trim()) {
      newErrors.name = 'Project name is required';
    }

    if (labelsList.length === 0) {
      newErrors.labels = 'At least one label is required';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    onSubmit({
      name: name.trim(),
      description: description.trim(),
      labels,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddLabel();
    }
  };

  return (
    <div className="create-project-container">
      <form onSubmit={handleSubmit} className="create-project-form">
        <Card variant="elevated" padding="large">
          <div className="form-section">
            <h3 className="form-section-title">Project Information</h3>
            <p className="form-section-desc">
              Give your project a clear name and description to help you organize your work.
            </p>

            <div className="form-fields">
              <Input
                label="Project Name"
                placeholder="e.g., Urban Traffic Detection"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (errors.name) setErrors(prev => ({ ...prev, name: undefined }));
                }}
                error={errors.name}
              />

              <TextArea
                label="Description (optional)"
                placeholder="Describe the purpose of this project..."
                value={description}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <div className="form-section">
            <h3 className="form-section-title">Labels</h3>
            <p className="form-section-desc">
              Define the labels you want to use for masks. You can add more labels later.
            </p>

            {labelsList.length > 0 && (
              <div className="classes-preview">
                {labelsList.map(label => (
                  <ClassBadge
                    key={label.labelId}
                    name={label.name}
                    color={label.color}
                    onRemove={() => handleRemoveLabel(label.labelId)}
                  />
                ))}
              </div>
            )}

            <div className="add-class-row">
              <Input
                placeholder="Label name (e.g., Car, Pedestrian)"
                value={newLabelName}
                onChange={(e) => {
                  setNewLabelName(e.target.value);
                  if (errors.labels) setErrors(prev => ({ ...prev, labels: undefined }));
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

            {errors.labels && (
              <p className="form-error">{errors.labels}</p>
            )}

            <div className="color-presets">
              <span className="preset-label">Quick colors:</span>
              {DEFAULT_COLORS.map(color => (
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
        </Card>

        <div className="form-actions">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={loading}>
            Create Project
          </Button>
        </div>
      </form>

      <div className="create-project-preview">
        <Card variant="bordered" padding="medium">
          <h4 className="preview-title">Preview</h4>
          <div className="preview-content">
            <div className="preview-name">{name || 'Project Name'}</div>
            <div className="preview-desc">
              {description || 'Project description will appear here.'}
            </div>
            <div className="preview-classes">
              <span className="preview-label">Labels ({labelsList.length}):</span>
              {labelsList.length === 0 ? (
                <span className="muted">No labels added yet</span>
              ) : (
                <div className="preview-class-list">
                  {labelsList.map(label => (
                    <span
                      key={label.labelId}
                      className="preview-class"
                      style={{ borderColor: label.color }}
                    >
                      <span className="preview-class-dot" style={{ backgroundColor: label.color }} />
                      {label.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
