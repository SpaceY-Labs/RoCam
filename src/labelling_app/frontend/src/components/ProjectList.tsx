import type { Project, Label } from '../types';
import { Card, StatCard, ClassBadge, EmptyState, Button } from './ui';
import './ProjectList.css';

interface ProjectListProps {
  projects: Project[];
  activeProjectId: string | null;
  onRequestSelectProject: (project: Project) => void;
  onCreateNew: () => void;
  onDeleteProject: (project: Project) => void;
  deletingProjectId?: string | null;
  loading?: boolean;
}

export function ProjectList({
  projects,
  activeProjectId,
  onRequestSelectProject,
  onCreateNew,
  onDeleteProject,
  deletingProjectId,
  loading = false,
}: ProjectListProps) {
  const selectedProject = projects.find(p => p.projectId === activeProjectId);

  if (loading) {
    return (
      <div className="project-list-container">
        <div className="loading-state">
          <div className="loading-spinner" />
          <span>Loading projects...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="project-list-container">
      <div className="project-list-grid">
        {/* Left Panel - Project List */}
        <div className="project-list-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Project list</p>
              <h2>Your projects</h2>
            </div>
            <Button variant="ghost" size="small" onClick={onCreateNew}>
              + New project
            </Button>
          </div>

          {projects.length === 0 ? (
            <EmptyState
              icon={<ProjectIcon />}
              title="No projects yet"
              description="Create your first project to start labeling images."
              action={{ label: 'Create project', onClick: onCreateNew }}
            />
          ) : (
            <div className="project-items">
              {projects.map(project => (
                <ProjectCard
                  key={project.projectId}
                  project={project}
                  isSelected={project.projectId === activeProjectId}
                  onSelect={() => onRequestSelectProject(project)}
                  onDelete={() => onDeleteProject(project)}
                  isDeleting={deletingProjectId === project.projectId}
                />
              ))}
            </div>
          )}
        </div>

        {/* Right Panel - Project Details */}
        <div className="project-detail-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Details</p>
              <h2>Project overview</h2>
            </div>
          </div>

          {!selectedProject ? (
            <EmptyState
              title="Select a project"
              description="Choose a project from the list to view its details."
            />
          ) : (
            <ProjectDetails project={selectedProject} />
          )}
        </div>
      </div>
    </div>
  );
}

/** Helper to get array of labels from the labels map */
const getLabelsArray = (labels: Project['labels']): Label[] => {
  if (!labels) return [];
  return Object.values(labels);
};

function ProjectCard({
  project,
  isSelected,
  onSelect,
  onDelete,
  isDeleting,
}: {
  project: Project;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const progress = project.imageCount
    ? Math.round((project.labeledCount || 0) / project.imageCount * 100)
    : 0;

  const labelsList = getLabelsArray(project.labels);

  return (
    <Card
      className="project-card"
      active={isSelected}
      variant="bordered"
    >
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
            onClick={(event) => {
              event.stopPropagation();
              onSelect();
            }}
            disabled={isSelected}
          >
            {isSelected ? 'Selected' : 'Select'}
          </Button>
          <Button
            variant="danger"
            size="small"
            className="project-delete-btn"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            loading={isDeleting}
          >
            Delete
          </Button>
        </div>
      </div>
      <p className="project-card-desc">
        {project.description || 'No description'}
      </p>
      <div className="project-card-footer">
        <div className="project-progress">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <span className="progress-text">{progress}% labeled</span>
        </div>
        <div className="project-classes">
          {labelsList.slice(0, 3).map(label => (
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

function ProjectDetails({ project }: { project: Project }) {
  const progress = project.imageCount
    ? Math.round((project.labeledCount || 0) / project.imageCount * 100)
    : 0;
  const unlabeled = (project.imageCount || 0) - (project.labeledCount || 0);
  const labelsList = getLabelsArray(project.labels);

  return (
    <div className="project-details">
      <div className="detail-section">
        <h3 className="detail-title">{project.name}</h3>
        <p className="detail-description">
          {project.description || 'No description provided.'}
        </p>
        <p className="detail-date">
          Created {new Date(project.createdAt || Date.now()).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </p>
      </div>

      <div className="stats-grid">
        <StatCard label="Total Images" value={project.imageCount || 0} />
        <StatCard label="Labeled" value={project.labeledCount || 0} />
        <StatCard label="Remaining" value={unlabeled} />
        <StatCard label="Progress" value={`${progress}%`} />
      </div>

      <div className="detail-section">
        <h4 className="section-label">Label Classes</h4>
        {labelsList.length === 0 ? (
          <p className="muted">No labels defined</p>
        ) : (
          <div className="classes-list">
            {labelsList.map(label => (
              <ClassBadge key={label.labelId} name={label.name} color={label.color} />
            ))}
          </div>
        )}
      </div>

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

function ProjectIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  );
}
