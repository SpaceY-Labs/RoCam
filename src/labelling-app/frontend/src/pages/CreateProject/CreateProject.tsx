/**
 * CreateProject - Project creation page
 * Form for creating new projects with name, description, and labels
 */

import { useState, type ChangeEvent } from 'react';
import type { LabelsMap, ProjectFormData } from '../../types';
import { Button, Input, TextArea, Card } from '../../components/ui';
import { LabelManager } from './components/LabelManager';
import { ProjectPreview } from './components/ProjectPreview';
import './CreateProject.css';

// ============ Types ============
export interface CreateProjectProps {
  /** Callback when form is submitted */
  onSubmit: (data: ProjectFormData) => void;
  /** Callback when cancel is clicked */
  onCancel: () => void;
  /** Whether submission is in progress */
  loading?: boolean;
}

// ============ Component ============
export function CreateProject({
  onSubmit,
  onCancel,
  loading = false,
}: CreateProjectProps) {
  // ============ Form State ============
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [labels, setLabels] = useState<LabelsMap>({});
  const [errors, setErrors] = useState<{ name?: string; labels?: string }>({});

  const labelsList = Object.values(labels);

  // ============ Handlers ============

  /**
   * Handle form submission
   */
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate
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

    // Submit
    onSubmit({
      name: name.trim(),
      description: description.trim(),
      labels,
    });
  };

  /**
   * Handle name change
   */
  const handleNameChange = (e: ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value);
    if (errors.name) {
      setErrors((prev) => ({ ...prev, name: undefined }));
    }
  };

  /**
   * Handle description change
   */
  const handleDescriptionChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setDescription(e.target.value);
  };

  /**
   * Handle labels change
   */
  const handleLabelsChange = (newLabels: LabelsMap) => {
    setLabels(newLabels);
  };

  /**
   * Clear labels error
   */
  const handleClearLabelsError = () => {
    if (errors.labels) {
      setErrors((prev) => ({ ...prev, labels: undefined }));
    }
  };

  // ============ Render ============
  return (
    <div className="create-project-container">
      {/* Form */}
      <form onSubmit={handleSubmit} className="create-project-form">
        <Card variant="elevated" padding="large">
          {/* Project Information Section */}
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
                onChange={handleNameChange}
                error={errors.name}
              />

              <TextArea
                label="Description (optional)"
                placeholder="Describe the purpose of this project..."
                value={description}
                onChange={handleDescriptionChange}
                rows={3}
              />
            </div>
          </div>

          {/* Labels Section */}
          <LabelManager
            labels={labels}
            onLabelsChange={handleLabelsChange}
            error={errors.labels}
            onClearError={handleClearLabelsError}
          />
        </Card>

        {/* Form Actions */}
        <div className="form-actions">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={loading}>
            Create Project
          </Button>
        </div>
      </form>

      {/* Live Preview */}
      <ProjectPreview name={name} description={description} labels={labelsList} />
    </div>
  );
}

export default CreateProject;
