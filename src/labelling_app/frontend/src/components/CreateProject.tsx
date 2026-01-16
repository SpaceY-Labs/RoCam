import { useState, type ChangeEvent } from 'react';
import type { LabelClass, ProjectFormData } from '../types';
import { Button, Input, TextArea, ColorInput, ClassBadge, Card } from './ui';

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
  const [classes, setClasses] = useState<LabelClass[]>([]);
  const [newClassName, setNewClassName] = useState('');
  const [newClassColor, setNewClassColor] = useState(DEFAULT_COLORS[0]);
  const [errors, setErrors] = useState<{ name?: string; classes?: string }>({});

  const handleAddClass = () => {
    if (!newClassName.trim()) return;

    // Check for duplicate names
    if (classes.some(c => c.name.toLowerCase() === newClassName.trim().toLowerCase())) {
      setErrors(prev => ({ ...prev, classes: 'Class name already exists' }));
      return;
    }

    const newClass: LabelClass = {
      id: generateId('cls'),
      name: newClassName.trim(),
      color: newClassColor,
    };

    setClasses([...classes, newClass]);
    setNewClassName('');
    setNewClassColor(DEFAULT_COLORS[(classes.length + 1) % DEFAULT_COLORS.length]);
    setErrors(prev => ({ ...prev, classes: undefined }));
  };

  const handleRemoveClass = (classId: string) => {
    setClasses(classes.filter(c => c.id !== classId));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const newErrors: typeof errors = {};

    if (!name.trim()) {
      newErrors.name = 'Project name is required';
    }

    if (classes.length === 0) {
      newErrors.classes = 'At least one class is required';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    onSubmit({
      name: name.trim(),
      description: description.trim(),
      classes,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddClass();
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
            <h3 className="form-section-title">Label Classes</h3>
            <p className="form-section-desc">
              Define the object classes you want to label. You can add more classes later.
            </p>

            {classes.length > 0 && (
              <div className="classes-preview">
                {classes.map(cls => (
                  <ClassBadge
                    key={cls.id}
                    name={cls.name}
                    color={cls.color}
                    onRemove={() => handleRemoveClass(cls.id)}
                  />
                ))}
              </div>
            )}

            <div className="add-class-row">
              <Input
                placeholder="Class name (e.g., Car, Pedestrian)"
                value={newClassName}
                onChange={(e) => {
                  setNewClassName(e.target.value);
                  if (errors.classes) setErrors(prev => ({ ...prev, classes: undefined }));
                }}
                onKeyDown={handleKeyDown}
                className="class-name-input"
              />
              <ColorInput
                value={newClassColor}
                onChange={setNewClassColor}
                className="class-color-input"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={handleAddClass}
                disabled={!newClassName.trim()}
              >
                Add Class
              </Button>
            </div>

            {errors.classes && (
              <p className="form-error">{errors.classes}</p>
            )}

            <div className="color-presets">
              <span className="preset-label">Quick colors:</span>
              {DEFAULT_COLORS.map(color => (
                <button
                  key={color}
                  type="button"
                  className={`color-preset ${newClassColor === color ? 'active' : ''}`}
                  style={{ backgroundColor: color }}
                  onClick={() => setNewClassColor(color)}
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
              <span className="preview-label">Classes ({classes.length}):</span>
              {classes.length === 0 ? (
                <span className="muted">No classes added yet</span>
              ) : (
                <div className="preview-class-list">
                  {classes.map(cls => (
                    <span
                      key={cls.id}
                      className="preview-class"
                      style={{ borderColor: cls.color }}
                    >
                      <span className="preview-class-dot" style={{ backgroundColor: cls.color }} />
                      {cls.name}
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
