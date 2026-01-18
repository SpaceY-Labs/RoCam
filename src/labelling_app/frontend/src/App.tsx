import { useEffect, useState, useRef, useCallback } from 'react';
import type { CSSProperties } from 'react';
import './App.css';
import type {
  RouteId,
  Project,
  ProjectImage,
  ProjectFormData,
  ImageStatus,
  BoundingBox,
  LabelClass,
  ImageMask,
  MaskSource,
  SegmentMask,
} from './types';
import { ProjectList } from './components/ProjectList';
import { CreateProject } from './components/CreateProject';
import { ImageUpload } from './components/ImageUpload';
import { LabelImage } from './components/LabelImage';
import { ConfirmModal } from './components/ui';
import {
  listProjects,
  createProject,
  getProject,
  listImages,
  deleteProject,
  getAvailableImages,
  acquireLocks,
  releaseLocks,
  updateImage,
  segmentImage,
  uploadImageToBackend,
} from './modules/API_Helps';

const LOCK_BATCH_SIZE = 5;
const LOCK_DURATION_MS = 20 * 60 * 1000;
const LOCK_REFRESH_MS = 5 * 60 * 1000;

const NAV_ITEMS: Array<{
  id: RouteId;
  label: string;
  description: string;
  icon: string;
}> = [
  {
    id: 'projects',
    label: 'Projects',
    description: 'Browse and select',
    icon: 'P',
  },
  {
    id: 'create',
    label: 'Create',
    description: 'New project setup',
    icon: 'C',
  },
  {
    id: 'label',
    label: 'Label',
    description: 'Annotate images',
    icon: 'L',
  },
  {
    id: 'upload',
    label: 'Upload',
    description: 'Add new images',
    icon: 'U',
  },
];

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
  label: {
    eyebrow: 'Annotation',
    title: 'Label Images',
    subtitle: 'Draw bounding boxes to annotate objects.',
  },
  upload: {
    eyebrow: 'Ingest',
    title: 'Upload Images',
    subtitle: 'Add new images to your project queue.',
  },
};

const panelStyle = (delay: string): CSSProperties =>
  ({ '--delay': delay } as CSSProperties);

const getRouteFromHash = (): RouteId => {
  const hash = window.location.hash.replace('#', '');
  const match = NAV_ITEMS.find((item) => item.id === hash);
  return match ? match.id : 'projects';
};

const getErrorMessage = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback;

const getResponseCount = (response: { total?: number; items: unknown[] }) =>
  typeof response.total === 'number' ? response.total : response.items.length;

const resolveMaskClass = (project: Project, classId?: string): LabelClass => {
  if (classId) {
    const match = project.classes.find((cls) => cls.id === classId);
    if (match) {
      return match;
    }
  }
  return (
    project.classes[0] || {
      id: classId || 'unknown',
      name: 'Unknown',
      color: '#999999',
    }
  );
};

const buildPolygonFromBox = (box: BoundingBox) => ([
  [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ],
]);

const buildMasksFromBoxes = (
  boxes: BoundingBox[],
  project: Project
): ImageMask[] =>
  boxes.map((box) => {
    const cls = resolveMaskClass(project, box.classId);
    return {
      id: box.id,
      classId: cls.id,
      className: cls.name,
      color: cls.color,
      polygon: box.mask ? undefined : buildPolygonFromBox(box),
      rle: box.mask,
      boundingBox: {
        x: box.x,
        y: box.y,
        w: box.width,
        h: box.height,
      },
      source: (box.source || 'manual') as MaskSource,
    };
  });

const scalePolygonIfNormalized = (
  polygon: ImageMask['polygon'],
  width?: number,
  height?: number
) => {
  if (!polygon || !width || !height || width <= 1 || height <= 1) {
    return polygon;
  }

  let maxX = 0;
  let maxY = 0;
  for (const ring of polygon) {
    for (const point of ring) {
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }

  if (maxX <= 1 && maxY <= 1) {
    return polygon.map((ring) =>
      ring.map((point) => ({
        x: point.x * width,
        y: point.y * height,
      }))
    );
  }

  return polygon;
};

const buildMasksFromSegments = (
  segments: SegmentMask[],
  targetClass: LabelClass,
  source: MaskSource,
  imageSize?: { width: number; height: number }
): ImageMask[] =>
  segments
    .filter((segment) => segment.rle || (Array.isArray(segment.polygon) && segment.polygon.length > 0))
    .map((segment, index) => ({
      id: `mask_${Date.now()}_${index}`,
      classId: targetClass.id,
      className: targetClass.name,
      color: targetClass.color,
      polygon: segment.rle
        ? undefined
        : segment.polygon
          ? scalePolygonIfNormalized(
              segment.polygon,
              imageSize?.width,
              imageSize?.height
            )
          : undefined,
      rle: segment.rle,
      boundingBox: segment.boundingBox,
      source,
    }));

function App() {
  // Routing
  const [route, setRoute] = useState<RouteId>(() => getRouteFromHash());

  // Data state
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectDetails, setProjectDetails] = useState<Project | null>(null);
  const [availableImages, setAvailableImages] = useState<ProjectImage[]>([]);
  const [lockedIds, setLockedIds] = useState<string[]>([]);

  // UI state
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [queueLoading, setQueueLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [switchTarget, setSwitchTarget] = useState<Project | null>(null);

  const refreshTimer = useRef<number | null>(null);

  // Derived state
  const projectFromList = projects.find(p => p.projectId === selectedProjectId) || null;
  const selectedProject = projectDetails
    ? {
        ...projectDetails,
        imageCount: projectFromList?.imageCount ?? projectDetails.imageCount,
        labeledCount: projectFromList?.labeledCount ?? projectDetails.labeledCount,
        unlabeledCount: projectFromList?.unlabeledCount ?? projectDetails.unlabeledCount,
      }
    : projectFromList;
  const pageMeta = PAGE_META[route];

  // Navigation
  const navigate = (id: RouteId) => {
    if (window.location.hash !== `#${id}`) {
      window.location.hash = id;
    }
    setRoute(id);
    setError(null);
  };

  // Show notification
  const showNotification = (message: string) => {
    setNotification(message);
    setTimeout(() => setNotification(null), 3000);
  };

  // API: Load projects list
  const refreshProjects = useCallback(async () => {
    setProjectsLoading(true);
    setError(null);
    try {
      const response = await listProjects();
      const items = (response.items || []).map((item) => ({
        projectId: item.projectId,
        name: item.name,
        description: item.description || null,
        classes: item.classes || [],
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
            const labeled = Math.max(total - unlabeled, 0);
            return {
              ...item,
              imageCount: total,
              labeledCount: labeled,
              unlabeledCount: unlabeled,
            };
          } catch {
            return item;
          }
        })
      );

      setProjects(itemsWithCounts);

      setSelectedProjectId((prev) => prev ?? itemsWithCounts[0]?.projectId ?? null);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load projects'));
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  // API: Load project details
  const loadProjectDetails = useCallback(async (projectId: string) => {
    try {
      const details = await getProject(projectId);
      setProjectDetails({
        projectId: details.projectId,
        name: details.name,
        description: details.description || null,
        classes: details.classes || [],
        createdAt: details.createdAt || new Date().toISOString(),
        imageCount: details.imageCount || 0,
        labeledCount: details.labeledCount || 0,
      });
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load project'));
    }
  }, []);

  // API: Load available images and acquire locks
  const loadAvailableQueue = useCallback(async (projectId: string) => {
    setQueueLoading(true);
    try {
      const response = await getAvailableImages(projectId, {
        limit: LOCK_BATCH_SIZE,
        status: 'unlabeled',
        includeFileUrl: true,
      });

      const items = response.items || [];
      if (items.length === 0) {
        setAvailableImages([]);
        setLockedIds([]);
        return;
      }

      const lockResponse = await acquireLocks(
        projectId,
        items.map((item) => item.imageId),
        LOCK_DURATION_MS
      );

      const locked = (lockResponse.results || [])
        .filter((result) => result.locked)
        .map((result) => result.imageId);

      const lockedImages: ProjectImage[] = items
        .filter((item) => locked.includes(item.imageId))
        .map((item) => ({
          imageId: item.imageId,
          projectId: projectId,
          meta: {
            fileName: item.meta?.fileName || 'Unknown',
            width: item.meta?.width || 0,
            height: item.meta?.height || 0,
            status: item.meta?.status || 'unlabeled',
            tags: item.meta?.tags || [],
          },
          fileUrl: item.fileUrl,
          createdAt: item.createdAt || new Date().toISOString(),
          masks: item.masks || [],
        }));

      setAvailableImages(lockedImages);
      setLockedIds(locked);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load images'));
    } finally {
      setQueueLoading(false);
    }
  }, []);

  // API: Refresh locks
  const refreshLocks = useCallback(async () => {
    if (!selectedProjectId || lockedIds.length === 0) {
      return;
    }
    try {
      await acquireLocks(selectedProjectId, lockedIds, LOCK_DURATION_MS);
    } catch (err: unknown) {
      console.error('Failed to refresh locks:', err);
    }
  }, [lockedIds, selectedProjectId]);

  // Hash change listener
  useEffect(() => {
    if (!window.location.hash) {
      window.history.replaceState(null, '', '#projects');
    }

    const onHashChange = () => {
      setRoute(getRouteFromHash());
    };

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

  // Load queue when on label page
  useEffect(() => {
    if (!selectedProjectId || route !== 'label') {
      setAvailableImages([]);
      setLockedIds([]);
      return;
    }
    loadAvailableQueue(selectedProjectId);
  }, [loadAvailableQueue, selectedProjectId, route]);

  // Refresh locks periodically
  useEffect(() => {
    if (refreshTimer.current) {
      window.clearInterval(refreshTimer.current);
    }

    if (route !== 'label' || lockedIds.length === 0) {
      return;
    }

    refreshTimer.current = window.setInterval(() => {
      refreshLocks();
    }, LOCK_REFRESH_MS);

    return () => {
      if (refreshTimer.current) {
        window.clearInterval(refreshTimer.current);
      }
    };
  }, [lockedIds, refreshLocks, route]);

  // Handler: Create project
  const handleCreateProject = async (data: ProjectFormData) => {
    setCreatingProject(true);
    setError(null);
    try {
      const response = await createProject({
        name: data.name,
        description: data.description || null,
        classes: data.classes.map((cls: LabelClass) => ({
          id: cls.id,
          name: cls.name,
          color: cls.color,
        })),
      });

      setSelectedProjectId(response.projectId);
      await refreshProjects();
      showNotification(`Project "${data.name}" created successfully!`);
      navigate('projects');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to create project'));
    } finally {
      setCreatingProject(false);
    }
  };

  const requestDeleteProject = (project: Project) => {
    setDeleteTarget(project);
  };

  const handleConfirmDeleteProject = async () => {
    if (!deleteTarget || deletingProjectId) {
      return;
    }

    setDeletingProjectId(deleteTarget.projectId);
    setError(null);

    try {
      await deleteProject(deleteTarget.projectId);

      setProjects((prev) => prev.filter((project) => project.projectId !== deleteTarget.projectId));

      if (selectedProjectId === deleteTarget.projectId) {
        setSelectedProjectId(null);
        setProjectDetails(null);
        setAvailableImages([]);
        setLockedIds([]);
      }

      showNotification(`Project "${deleteTarget.name}" deleted successfully!`);
      setDeleteTarget(null);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to delete project'));
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
    if (!switchTarget) {
      return;
    }
    setProjectDetails(null);
    setAvailableImages([]);
    setLockedIds([]);
    setSelectedProjectId(switchTarget.projectId);
    setSwitchTarget(null);
  };

  // Handler: Upload image
  const handleUploadImage = async (file: File, meta: { status: ImageStatus; tags: string[] }) => {
    if (!selectedProjectId) {
      setError('Select a project first');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      // Get image dimensions
      const dimensions = await new Promise<{ width: number; height: number }>((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
          resolve({ width: img.width, height: img.height });
          URL.revokeObjectURL(url);
        };
        img.onerror = () => {
          resolve({ width: 0, height: 0 });
          URL.revokeObjectURL(url);
        };
        img.src = url;
      });

      const uploadResponse = await uploadImageToBackend(selectedProjectId, file, {
        fileName: file.name,
        width: dimensions.width,
        height: dimensions.height,
        status: meta.status,
        tags: meta.tags,
      });

      showNotification(`Image "${file.name}" uploaded successfully!`);

      const autoClass = selectedProject?.classes[0];
      if (autoClass) {
        try {
          const autoPrompt = autoClass.name || 'object';
          const segmentResponse = await segmentImage({
            projectId: selectedProjectId,
            imageId: uploadResponse.imageId,
            mode: 'auto',
            prompt: autoPrompt,
          });
          const masks = buildMasksFromSegments(
            segmentResponse.masks || [],
            autoClass,
            'sam3_auto',
            dimensions
          );
          if (masks.length > 0) {
            await updateImage(selectedProjectId, uploadResponse.imageId, { masks });
          }
        } catch (error) {
          console.warn('Auto segmentation failed:', error);
        }
      }

      // Refresh project details to update counts
      await loadProjectDetails(selectedProjectId);

      // If on label page, reload queue
      if (route === 'label') {
        await loadAvailableQueue(selectedProjectId);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Upload failed'));
    } finally {
      setUploading(false);
    }
  };

  // Handler: Save annotations (placeholder - needs backend endpoint)
  const handleSaveAnnotations = async (imageId: string, boxes: BoundingBox[]) => {
    if (!selectedProjectId || !selectedProject) {
      setError('Select a project first');
      return;
    }

    try {
      const masks = buildMasksFromBoxes(boxes, selectedProject);
      await updateImage(selectedProjectId, imageId, {
        meta: { status: 'labeled' },
        masks,
      });
      showNotification(`Saved ${boxes.length} annotations for image`);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to save annotations'));
      return;
    }

    let remainingLocks = lockedIds;
    if (lockedIds.includes(imageId)) {
      try {
        await releaseLocks(selectedProjectId, [imageId]);
        remainingLocks = lockedIds.filter((id) => id !== imageId);
        setLockedIds(remainingLocks);
      } catch (err: unknown) {
        console.warn('Failed to release image lock:', err);
      }
    }

    // Move to next image in queue
    const currentIndex = availableImages.findIndex(img => img.imageId === imageId);
    if (currentIndex >= availableImages.length - 1) {
      // Reload queue for more images
      if (selectedProjectId) {
        if (remainingLocks.length > 0) {
          try {
            await releaseLocks(selectedProjectId, remainingLocks);
          } catch (err: unknown) {
            console.warn('Failed to release locks:', err);
          }
          setLockedIds([]);
        }
        await loadAvailableQueue(selectedProjectId);
      }
    }
  };

  const handleReloadQueue = async () => {
    if (!selectedProjectId) {
      return;
    }

    if (lockedIds.length > 0) {
      try {
        await releaseLocks(selectedProjectId, lockedIds);
      } catch (err: unknown) {
        console.warn('Failed to release locks:', err);
      }
      setLockedIds([]);
    }

    await loadAvailableQueue(selectedProjectId);
  };

  const handleSegmentImage = useCallback(
    async (
      imageId: string,
      payload: {
        mode: 'click' | 'auto';
        resourceUrl?: string;
        points?: { x: number; y: number; label: 0 | 1 }[];
        prompt?: string;
      }
    ) => {
      if (!selectedProjectId) {
        throw new Error('Select a project first');
      }
      return segmentImage({ projectId: selectedProjectId, imageId, ...payload });
    },
    [selectedProjectId]
  );

  return (
    <div className="shell">
      {/* Sidebar Navigation */}
      <aside className="side-nav">
        <div className="nav-rail">
          <div className="nav-brand">
            <span className="brand-mark" />
            <div className="brand-copy">
              <span className="eyebrow">RoCam Labeler</span>
              <span className="brand-title">Studio</span>
            </div>
          </div>

          <nav className="nav-list">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={route === item.id ? 'nav-link active' : 'nav-link'}
                onClick={() => navigate(item.id)}
                aria-label={item.label}
              >
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">
                  <span className="nav-title">{item.label}</span>
                  <span className="nav-subtitle">{item.description}</span>
                </span>
              </button>
            ))}
          </nav>

          <div className="nav-footer">
            <div className="active-project">
              <p className="meta-label">Active project</p>
              <p className="meta-value">
                {selectedProject?.name || 'None selected'}
              </p>
                {selectedProject && (
                  <p className="muted small">
                    {selectedProject.unlabeledCount ?? selectedProject.imageCount ?? 0} unlabeled
                  </p>
                )}
            </div>
            <div className="status-row">
              <span className={queueLoading ? 'status-dot pulse' : 'status-dot'} />
              {queueLoading ? 'Syncing...' : 'Ready'}
            </div>
          </div>
        </div>
      </aside>

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
            {route === 'projects' && (
              <button
                className="btn btn-ghost btn-small"
                onClick={refreshProjects}
                disabled={projectsLoading}
              >
                {projectsLoading ? 'Refreshing...' : 'Refresh Projects'}
              </button>
            )}
            {route === 'label' && selectedProjectId && (
              <button
                className="btn btn-ghost btn-small"
                onClick={handleReloadQueue}
                disabled={queueLoading}
              >
                {queueLoading ? 'Loading...' : 'Reload Queue'}
              </button>
            )}
          </div>
        </header>

        {/* Notifications */}
        {notification && (
          <div className="banner success">
            <span>{notification}</span>
            <button className="btn btn-ghost btn-small" onClick={() => setNotification(null)}>
              Dismiss
            </button>
          </div>
        )}

        {/* Error Banner */}
        {error && (
          <div className="banner error">
            <span>{error}</span>
            <button className="btn btn-ghost btn-small" onClick={() => setError(null)}>
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

        {route === 'label' && (
          <section className="panel label-panel" style={panelStyle('0.05s')}>
            <LabelImage
              project={selectedProject}
              images={availableImages}
              onSelectProject={() => navigate('projects')}
              onSaveAnnotations={handleSaveAnnotations}
              onSegmentImage={handleSegmentImage}
              onNextImage={() => {}}
              onPrevImage={() => {}}
              loading={queueLoading}
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
      </main>

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

export default App;
