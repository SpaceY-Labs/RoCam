/**
 * App - Main application shell
 * Handles routing, global state, and API orchestration
 */

import { useEffect, useState, useCallback } from 'react';
import type { CSSProperties } from 'react';
import type { User } from 'firebase/auth';
import './styles/app-shell.css';
import './styles/utilities.css';
import type { RouteId, Project, ProjectFormData, ImageStatus } from './types';
import { AuthProvider, useAuth } from './context/AuthContext';

// ============ Components ============
import { ConfirmModal } from './components/ui';
import { Sidebar, NAV_ITEMS } from './components/shared';
import {
  ProjectList,
  CreateProject,
  ImageUpload,
  PreviewGallery,
  Login,
} from './pages';

// ============ Hooks ============
import { useNotifications } from './hooks';

// ============ API ============
import {
  listProjects,
  createProject,
  getProject,
  listImages,
  deleteProject,
  uploadZipToBackend,
} from './modules/API_Helps';

const PAGE_META: Record<RouteId, { eyebrow: string; title: string; subtitle: string }> = {
  projects: {
    eyebrow: 'Workspace',
    title: 'Projects',
    subtitle: 'Manage your labeling projects and track progress.',
  },
  create: {
    eyebrow: 'Setup',
    title: 'Create Project',
    subtitle: 'Define your project and label classes.',
  },
  upload: {
    eyebrow: 'Ingest',
    title: 'Upload Images',
    subtitle: 'Add new images to your project queue.',
  },
  preview: {
    eyebrow: 'Management',
    title: 'Manage Images',
    subtitle: 'Review labels, tags, and progress in-place.',
  },
};

// ============ Helpers ============
const panelStyle = (delay: string): CSSProperties =>
  ({ '--delay': delay } as CSSProperties);

const getRouteFromHash = (): RouteId => {
  const hash = window.location.hash.replace('#', '');
  const match = NAV_ITEMS.find((item) => item.id === hash);
  return match ? match.id : 'projects';
};

const getResponseCount = (response: { total?: number; items: unknown[] }) =>
  typeof response.total === 'number' ? response.total : response.items.length;

// ============ Component ============
type AuthenticatedAppProps = {
  user: User;
  onSignOut: () => Promise<void>;
};

function AuthenticatedApp({ user, onSignOut }: AuthenticatedAppProps) {
  // ============ Routing ============
  const [route, setRoute] = useState<RouteId>(() => getRouteFromHash());

  // ============ Data State ============
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectDetails, setProjectDetails] = useState<Project | null>(null);

  // ============ UI State ============
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [switchTarget, setSwitchTarget] = useState<Project | null>(null);

  // ============ Hooks ============
  const { notification, error, showNotification, showError, clearNotification, clearError } =
    useNotifications();

  // ============ Derived State ============
  const projectFromList = projects.find((p) => p.projectId === selectedProjectId) || null;
  const selectedProject = projectDetails
    ? {
        ...projectDetails,
        imageCount: projectFromList?.imageCount ?? projectDetails.imageCount,
        labeledCount: projectFromList?.labeledCount ?? projectDetails.labeledCount,
        unlabeledCount: projectFromList?.unlabeledCount ?? projectDetails.unlabeledCount,
      }
    : projectFromList;
  const pageMeta = PAGE_META[route];
  const authDisplayName = user.displayName || user.email || user.uid;

  // ============ Navigation ============
  const navigate = (id: RouteId) => {
    if (window.location.hash !== `#${id}`) {
      window.location.hash = id;
    }
    setRoute(id);
    clearError();
  };

  // ============ API: Load Projects ============
  const refreshProjects = useCallback(async () => {
    setProjectsLoading(true);
    clearError();
    try {
      const response = await listProjects();
      const items = (response.items || []).map((item) => ({
        projectId: item.projectId,
        name: item.name,
        description: item.description || null,
        labels: item.labels || {},
        createdAt: item.createdAt || new Date().toISOString(),
        imageCount: item.imageCount || 0,
        labeledCount: item.labeledCount || 0,
      }));

      const itemsWithCounts = await Promise.all(
        items.map(async (item) => {
          try {
            const [totalResponse, unlabeledResponse] = await Promise.all([
              listImages(item.projectId, { includeTotal: true, limit: 1 }),
              listImages(item.projectId, { status: 'unlabeled', includeTotal: true, limit: 1 }),
            ]);
            const total = getResponseCount(totalResponse);
            const unlabeled = getResponseCount(unlabeledResponse);
            return {
              ...item,
              imageCount: total,
              labeledCount: Math.max(total - unlabeled, 0),
              unlabeledCount: unlabeled,
            };
          } catch {
            return item;
          }
        })
      );

      setProjects(itemsWithCounts);
      setSelectedProjectId((prev) => prev ?? itemsWithCounts[0]?.projectId ?? null);
    } catch (err) {
      showError(err, 'Failed to load projects');
    } finally {
      setProjectsLoading(false);
    }
  }, [clearError, showError]);

  // ============ API: Load Project Details ============
  const loadProjectDetails = useCallback(
    async (projectId: string) => {
      try {
        const details = await getProject(projectId);
        setProjectDetails({
          projectId: details.projectId,
          name: details.name,
          description: details.description || null,
          labels: details.labels || {},
          createdAt: details.createdAt || new Date().toISOString(),
          imageCount: details.imageCount || 0,
          labeledCount: details.labeledCount || 0,
        });
      } catch (err) {
        showError(err, 'Failed to load project');
      }
    },
    [showError]
  );

  // ============ Effects ============

  // Hash change listener
  useEffect(() => {
    if (!window.location.hash) {
      window.history.replaceState(null, '', '#projects');
    }

    const onHashChange = () => setRoute(getRouteFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Load projects on mount
  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  // Load project details when selection changes
  useEffect(() => {
    if (!selectedProjectId) {
      setProjectDetails(null);
      return;
    }
    loadProjectDetails(selectedProjectId);
  }, [loadProjectDetails, selectedProjectId]);

  // ============ Handlers ============

  const handleCreateProject = async (data: ProjectFormData) => {
    setCreatingProject(true);
    clearError();
    try {
      const response = await createProject({
        name: data.name,
        description: data.description || null,
        labels: data.labels,
      });

      setSelectedProjectId(response.projectId);
      await refreshProjects();
      showNotification(`Project "${data.name}" created successfully!`);
      navigate('projects');
    } catch (err) {
      showError(err, 'Failed to create project');
    } finally {
      setCreatingProject(false);
    }
  };

  const requestDeleteProject = (project: Project) => {
    setDeleteTarget(project);
  };

  const handleConfirmDeleteProject = async () => {
    if (!deleteTarget || deletingProjectId) return;

    setDeletingProjectId(deleteTarget.projectId);
    clearError();

    try {
      await deleteProject(deleteTarget.projectId);
      setProjects((prev) => prev.filter((p) => p.projectId !== deleteTarget.projectId));

      if (selectedProjectId === deleteTarget.projectId) {
        setSelectedProjectId(null);
        setProjectDetails(null);
      }

      showNotification(`Project "${deleteTarget.name}" deleted successfully!`);
      setDeleteTarget(null);
    } catch (err) {
      showError(err, 'Failed to delete project');
    } finally {
      setDeletingProjectId(null);
    }
  };

  const requestSwitchProject = (project: Project) => {
    if (selectedProjectId && selectedProjectId !== project.projectId) {
      setSwitchTarget(project);
      return;
    }
    setSelectedProjectId(project.projectId);
  };

  const handleConfirmSwitchProject = () => {
    if (!switchTarget) return;
    setProjectDetails(null);
    setSelectedProjectId(switchTarget.projectId);
    setSwitchTarget(null);
  };

  const handleUploadImage = async (file: File, meta: { status: ImageStatus; tags: string[] }) => {
    if (!selectedProjectId) {
      showError('Select a project first');
      return;
    }

    setUploading(true);
    clearError();

    try {
      const isZip = file.type.includes('zip') || file.name.toLowerCase().endsWith('.zip');
      if (!isZip) {
        showError('Only ZIP files are accepted');
        setUploading(false);
        return;
      }

      const zipResponse = await uploadZipToBackend(selectedProjectId, file, {
        status: meta.status,
        tags: meta.tags,
      });
      showNotification(`Uploaded ${zipResponse.count} images from "${file.name}"`);
      await loadProjectDetails(selectedProjectId);
    } catch (err) {
      showError(err, 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await onSignOut();
    } catch (err) {
      showError(err, 'Failed to sign out');
    }
  };

  // ============ Render ============
  return (
    <div className="shell">
      {/* Sidebar */}
      <Sidebar
        currentRoute={route}
        selectedProject={selectedProject}
        onNavigate={navigate}
      />

      {/* Main Content */}
      <main className="page">
        {/* Page Header */}
        <header className="page-header">
          <div>
            <p className="eyebrow">{pageMeta.eyebrow}</p>
            <h1>{pageMeta.title}</h1>
            <p className="muted">{pageMeta.subtitle}</p>
          </div>
          <div className="header-actions">
            <div className="auth-summary">
              <p className="eyebrow">Signed in</p>
              <p className="muted">{authDisplayName}</p>
            </div>
            <button className="btn btn-ghost btn-small" onClick={handleSignOut}>
              Sign Out
            </button>
            {route === 'projects' && (
              <button
                className="btn btn-ghost btn-small"
                onClick={refreshProjects}
                disabled={projectsLoading}
              >
                {projectsLoading ? 'Refreshing...' : 'Refresh Projects'}
              </button>
            )}
          </div>
        </header>

        {/* Notifications */}
        {notification && (
          <div className="banner success">
            <span>{notification}</span>
            <button className="btn btn-ghost btn-small" onClick={clearNotification}>
              Dismiss
            </button>
          </div>
        )}

        {/* Error Banner */}
        {error && (
          <div className="banner error">
            <span>{error}</span>
            <button className="btn btn-ghost btn-small" onClick={clearError}>
              Dismiss
            </button>
          </div>
        )}

        {/* Page Content */}
        {route === 'projects' && (
          <section className="panel" style={panelStyle('0.05s')}>
            <ProjectList
              projects={projects}
              activeProjectId={selectedProjectId}
              onRequestSelectProject={requestSwitchProject}
              onCreateNew={() => navigate('create')}
              onDeleteProject={requestDeleteProject}
              deletingProjectId={deletingProjectId}
              loading={projectsLoading}
            />
          </section>
        )}

        {route === 'create' && (
          <section className="panel" style={panelStyle('0.05s')}>
            <CreateProject
              onSubmit={handleCreateProject}
              onCancel={() => navigate('projects')}
              loading={creatingProject}
            />
          </section>
        )}

        {route === 'upload' && (
          <section className="panel" style={panelStyle('0.05s')}>
            <ImageUpload
              project={selectedProject}
              onUpload={handleUploadImage}
              onSelectProject={() => navigate('projects')}
              loading={uploading}
            />
          </section>
        )}

        {route === 'preview' && (
          <section className="panel" style={panelStyle('0.05s')}>
            <PreviewGallery project={selectedProject} onSelectProject={() => navigate('projects')} />
          </section>
        )}
      </main>

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDeleteProject}
        title="Delete project"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This will remove all images and locks in the project.`}
        confirmText={deletingProjectId ? 'Deleting...' : 'Delete'}
        cancelText="Cancel"
        variant="danger"
      />

      {/* Switch Project Confirmation Modal */}
      <ConfirmModal
        isOpen={Boolean(switchTarget)}
        onClose={() => setSwitchTarget(null)}
        onConfirm={handleConfirmSwitchProject}
        title="Switch project"
        message={`Switch active project to "${switchTarget?.name}"? Your current labeling queue will be cleared.`}
        confirmText="Switch"
        cancelText="Cancel"
        variant="primary"
      />
    </div>
  );
}

function AppShell() {
  const { user, loading, signOutUser } = useAuth();

  if (loading) {
    return (
      <div className="shell">
        <main className="page">
          <section className="panel">
            <p className="eyebrow">Authentication</p>
            <h1>Checking session</h1>
            <p className="muted">Please wait while we verify your sign-in status.</p>
          </section>
        </main>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return <AuthenticatedApp user={user} onSignOut={signOutUser} />;
}

function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}

export default App;
