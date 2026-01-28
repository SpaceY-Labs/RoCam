/**
 * ProjectList - Main project listing page
 * Displays all projects in a two-panel layout with selection
 */

import type { Project } from '../../types';
import { Button, EmptyState } from '../../components/ui';
import { ProjectCard } from './components/ProjectCard';
import { ProjectDetails } from './components/ProjectDetails';
import { ProjectIcon } from './components/ProjectIcon';
import './ProjectList.css';

// ============ Types ============
export interface ProjectListProps {
  /** List of all projects */
  projects: Project[];
  /** Currently active project ID */
  activeProjectId: string | null;
  /** Callback when user requests to select a project */
  onRequestSelectProject: (project: Project) => void;
  /** Callback when user wants to create new project */
  onCreateNew: () => void;
  /** Callback when user wants to delete a project */
  onDeleteProject: (project: Project) => void;
  /** ID of project currently being deleted */
  deletingProjectId?: string | null;
  /** Whether projects are loading */
  loading?: boolean;
}

// ============ Component ============
export function ProjectList({
  projects,
  activeProjectId,
  onRequestSelectProject,
  onCreateNew,
  onDeleteProject,
  deletingProjectId,
  loading = false,
}: ProjectListProps) {
  // Get currently selected project
  const selectedProject = projects.find((p) => p.projectId === activeProjectId);

  // ============ Loading State ============
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

  // ============ Main Render ============
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
              {projects.map((project) => (
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

export default ProjectList;
