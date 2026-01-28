/**
 * ProjectDetails - Detailed view of a selected project
 * Shows stats, labels, and progress
 */

import type { Project, Label } from '../../../types';
import { StatCard, ClassBadge } from '../../../components/ui';

// ============ Types ============
export interface ProjectDetailsProps {
  /** Project to display */
  project: Project;
}

// ============ Helpers ============

/**
 * Get array of labels from the labels map
 */
const getLabelsArray = (labels: Project['labels']): Label[] => {
  if (!labels) return [];
  return Object.values(labels);
};

/**
 * Format date for display
 */
const formatDate = (dateString: string | undefined): string => {
  const date = new Date(dateString || Date.now());
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

// ============ Component ============
export function ProjectDetails({ project }: ProjectDetailsProps) {
  // Calculate stats
  const progress = project.imageCount
    ? Math.round(((project.labeledCount || 0) / project.imageCount) * 100)
    : 0;
  const unlabeled = (project.imageCount || 0) - (project.labeledCount || 0);
  const labelsList = getLabelsArray(project.labels);

  // ============ Render ============
  return (
    <div className="project-details">
      {/* Project Info Section */}
      <div className="detail-section">
        <h3 className="detail-title">{project.name}</h3>
        <p className="detail-description">
          {project.description || 'No description provided.'}
        </p>
        <p className="detail-date">Created {formatDate(project.createdAt)}</p>
      </div>

      {/* Stats Grid */}
      <div className="stats-grid">
        <StatCard label="Total Images" value={project.imageCount || 0} />
        <StatCard label="Labeled" value={project.labeledCount || 0} />
        <StatCard label="Remaining" value={unlabeled} />
        <StatCard label="Progress" value={`${progress}%`} />
      </div>

      {/* Labels Section */}
      <div className="detail-section">
        <h4 className="section-label">Label Classes</h4>
        {labelsList.length === 0 ? (
          <p className="muted">No labels defined</p>
        ) : (
          <div className="classes-list">
            {labelsList.map((label) => (
              <ClassBadge key={label.labelId} name={label.name} color={label.color} />
            ))}
          </div>
        )}
      </div>

      {/* Progress Section */}
      <div className="detail-section">
        <h4 className="section-label">Progress</h4>
        <div className="large-progress">
          <div className="large-progress-bar">
            <div className="large-progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="large-progress-labels">
            <span>{project.labeledCount || 0} labeled</span>
            <span>{unlabeled} remaining</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProjectDetails;
