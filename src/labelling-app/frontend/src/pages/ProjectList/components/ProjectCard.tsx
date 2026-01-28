/**
 * ProjectCard - Individual project card in the list
 * Displays project name, description, progress, and labels
 */

import type { Project, Label } from '../../../types';
import { Card, Button } from '../../../components/ui';

// ============ Types ============
export interface ProjectCardProps {
  /** Project data */
  project: Project;
  /** Whether this project is selected */
  isSelected: boolean;
  /** Callback when select button is clicked */
  onSelect: () => void;
  /** Callback when delete button is clicked */
  onDelete: () => void;
  /** Whether deletion is in progress */
  isDeleting: boolean;
}

// ============ Helpers ============

/**
 * Get array of labels from the labels map
 */
const getLabelsArray = (labels: Project['labels']): Label[] => {
  if (!labels) return [];
  return Object.values(labels);
};

// ============ Component ============
export function ProjectCard({
  project,
  isSelected,
  onSelect,
  onDelete,
  isDeleting,
}: ProjectCardProps) {
  // Calculate progress percentage
  const progress = project.imageCount
    ? Math.round(((project.labeledCount || 0) / project.imageCount) * 100)
    : 0;

  const labelsList = getLabelsArray(project.labels);

  // ============ Event Handlers ============

  const handleSelectClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    onSelect();
  };

  const handleDeleteClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    onDelete();
  };

  // ============ Render ============
  return (
    <Card className="project-card" active={isSelected} variant="bordered">
      {/* Header - Name and Actions */}
      <div className="project-card-header">
        <h3 className="project-card-name">{project.name}</h3>
        <div className="project-card-actions">
          <span className="project-card-count">
            {project.unlabeledCount ?? project.imageCount ?? 0} unlabeled
          </span>
          <Button
            variant="secondary"
            size="small"
            className="project-select-btn"
            onClick={handleSelectClick}
            disabled={isSelected}
          >
            {isSelected ? 'Selected' : 'Select'}
          </Button>
          <Button
            variant="danger"
            size="small"
            className="project-delete-btn"
            onClick={handleDeleteClick}
            loading={isDeleting}
          >
            Delete
          </Button>
        </div>
      </div>

      {/* Description */}
      <p className="project-card-desc">
        {project.description || 'No description'}
      </p>

      {/* Footer - Progress and Labels */}
      <div className="project-card-footer">
        <div className="project-progress">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <span className="progress-text">{progress}% labeled</span>
        </div>
        <div className="project-classes">
          {labelsList.slice(0, 3).map((label) => (
            <span
              key={label.labelId}
              className="class-dot"
              style={{ backgroundColor: label.color }}
              title={label.name}
            />
          ))}
          {labelsList.length > 3 && (
            <span className="class-more">+{labelsList.length - 3}</span>
          )}
        </div>
      </div>
    </Card>
  );
}

export default ProjectCard;
