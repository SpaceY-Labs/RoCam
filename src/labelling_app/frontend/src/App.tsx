import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import {
  acquireLocks,
  createProject,
  getAvailableImages,
  getProject,
  listProjects,
  uploadImageToBackend,
} from "./modules/API_Helps";

const statusOptions = ["unlabeled", "in_progress", "labeled"] as const;
const LOCK_BATCH_SIZE = 5;
const LOCK_DURATION_MS = 20 * 60 * 1000;
const LOCK_REFRESH_MS = 5 * 60 * 1000;

const makeId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `cls_${Date.now()}`;

function App() {
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectDetails, setProjectDetails] = useState<any | null>(null);
  const [availableImages, setAvailableImages] = useState<any[]>([]);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const [lockedIds, setLockedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [projectForm, setProjectForm] = useState({
    name: "",
    description: "",
    className: "Object",
    classColor: "#F05D5E",
  });

  const [uploadState, setUploadState] = useState({
    file: null as File | null,
    width: 0,
    height: 0,
    status: "unlabeled",
    tags: "",
    uploading: false,
  });

  const refreshTimer = useRef<number | null>(null);

  const activeImage = useMemo(() => {
    if (!activeImageId) {
      return availableImages[0] || null;
    }
    return availableImages.find((image) => image.imageId === activeImageId) || null;
  }, [availableImages, activeImageId]);

  const refreshProjects = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await listProjects();
      const items = response.items || [];
      setProjects(items);
      if (!selectedProjectId && items.length > 0) {
        setSelectedProjectId(items[0].projectId);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load projects");
    } finally {
      setLoading(false);
    }
  };

  const loadProjectDetails = async (projectId: string) => {
    try {
      const details = await getProject(projectId);
      setProjectDetails(details);
    } catch (err: any) {
      setError(err.message || "Failed to load project");
    }
  };

  const loadAvailableQueue = async (projectId: string) => {
    try {
      const response = await getAvailableImages(projectId, {
        limit: LOCK_BATCH_SIZE,
        status: "unlabeled",
        includeFileUrl: true,
      });

      const items = response.items || [];
      if (items.length === 0) {
        setAvailableImages([]);
        setActiveImageId(null);
        setLockedIds([]);
        return;
      }

      const lockResponse = await acquireLocks(
        projectId,
        items.map((item) => item.imageId),
        LOCK_DURATION_MS
      );

      const locked = (lockResponse.results || [])
        .filter((result: any) => result.locked)
        .map((result: any) => result.imageId);

      const lockedImages = items.filter((item) => locked.includes(item.imageId));

      setAvailableImages(lockedImages);
      setLockedIds(locked);
      setActiveImageId(lockedImages[0]?.imageId || null);
    } catch (err: any) {
      setError(err.message || "Failed to lock images");
    }
  };

  const refreshLocks = async () => {
    if (!selectedProjectId || lockedIds.length === 0) {
      return;
    }

    try {
      await acquireLocks(selectedProjectId, lockedIds, LOCK_DURATION_MS);
    } catch (err: any) {
      setError(err.message || "Failed to refresh locks");
    }
  };

  useEffect(() => {
    refreshProjects();
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      return;
    }

    setError(null);
    loadProjectDetails(selectedProjectId);
    loadAvailableQueue(selectedProjectId);
  }, [selectedProjectId]);

  useEffect(() => {
    if (refreshTimer.current) {
      window.clearInterval(refreshTimer.current);
    }

    if (lockedIds.length === 0) {
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
  }, [lockedIds.join(","), selectedProjectId]);

  const handleCreateProject = async () => {
    setLoading(true);
    setError(null);
    try {
      if (!projectForm.name.trim()) {
        throw new Error("Project name is required");
      }
      const response = await createProject({
        name: projectForm.name.trim(),
        description: projectForm.description.trim() || null,
        classes: [
          {
            id: makeId(),
            name: projectForm.className.trim() || "Object",
            color: projectForm.classColor,
          },
        ],
      });
      setSelectedProjectId(response.projectId);
      setProjectForm({
        name: "",
        description: "",
        className: "Object",
        classColor: "#F05D5E",
      });
      await refreshProjects();
    } catch (err: any) {
      setError(err.message || "Failed to create project");
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = async (file: File | null) => {
    if (!file) {
      setUploadState((prev) => ({ ...prev, file: null }));
      return;
    }

    const image = new Image();
    const url = URL.createObjectURL(file);
    const dimensions = await new Promise<{ width: number; height: number }>(
      (resolve) => {
        image.onload = () => {
          resolve({ width: image.width, height: image.height });
          URL.revokeObjectURL(url);
        };
        image.src = url;
      }
    );

    setUploadState((prev) => ({
      ...prev,
      file,
      width: dimensions.width,
      height: dimensions.height,
    }));
  };

  const handleUpload = async () => {
    if (!selectedProjectId) {
      setError("Select a project first");
      return;
    }
    if (!uploadState.file) {
      setError("Select an image to upload");
      return;
    }

    setUploadState((prev) => ({ ...prev, uploading: true }));
    setError(null);

    try {
      const tags = uploadState.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);

      await uploadImageToBackend(selectedProjectId, uploadState.file, {
        fileName: uploadState.file.name,
        width: uploadState.width,
        height: uploadState.height,
        status: uploadState.status,
        tags,
      });

      setUploadState({
        file: null,
        width: 0,
        height: 0,
        status: "unlabeled",
        tags: "",
        uploading: false,
      });

      await loadAvailableQueue(selectedProjectId);
    } catch (err: any) {
      setError(err.message || "Upload failed");
    } finally {
      setUploadState((prev) => ({ ...prev, uploading: false }));
    }
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="dot" />
          <div>
            <p className="eyebrow">RoCam Labeler</p>
            <h1>Workspace</h1>
          </div>
        </div>

        <button className="ghost" onClick={refreshProjects} disabled={loading}>
          Refresh projects
        </button>

        <div className="project-list">
          {projects.length === 0 && <p className="muted">No projects yet.</p>}
          {projects.map((project) => (
            <button
              key={project.projectId}
              className={
                project.projectId === selectedProjectId
                  ? "project-item active"
                  : "project-item"
              }
              onClick={() => setSelectedProjectId(project.projectId)}
            >
              <span>{project.name}</span>
              <small>{project.description || "No description"}</small>
            </button>
          ))}
        </div>

        <div className="panel inset">
          <h2>New project</h2>
          <label>
            Name
            <input
              type="text"
              value={projectForm.name}
              onChange={(event) =>
                setProjectForm((prev) => ({
                  ...prev,
                  name: event.target.value,
                }))
              }
              placeholder="Urban Traffic"
            />
          </label>
          <label>
            Description
            <input
              type="text"
              value={projectForm.description}
              onChange={(event) =>
                setProjectForm((prev) => ({
                  ...prev,
                  description: event.target.value,
                }))
              }
              placeholder="Optional context"
            />
          </label>
          <div className="inline">
            <input
              type="text"
              value={projectForm.className}
              onChange={(event) =>
                setProjectForm((prev) => ({
                  ...prev,
                  className: event.target.value,
                }))
              }
            />
            <input
              type="color"
              value={projectForm.classColor}
              onChange={(event) =>
                setProjectForm((prev) => ({
                  ...prev,
                  classColor: event.target.value,
                }))
              }
            />
          </div>
          <button onClick={handleCreateProject} disabled={loading}>
            Create project
          </button>
        </div>
      </aside>

      <main className="main">
        {error && <div className="error">{error}</div>}

        <section className="panel hero">
          <div>
            <p className="eyebrow">Project overview</p>
            <h2>{projectDetails?.name || "Select a project"}</h2>
            <p className="muted">
              {projectDetails?.description || "No description provided."}
            </p>
          </div>
          <div className="meta-grid">
            <div>
              <p className="meta-label">Classes</p>
              <p className="meta-value">
                {projectDetails?.classes?.length || 0}
              </p>
            </div>
            <div>
              <p className="meta-label">Locked queue</p>
              <p className="meta-value">{lockedIds.length}</p>
            </div>
            <div>
              <p className="meta-label">Lock refresh</p>
              <p className="meta-value">every 5 min</p>
            </div>
          </div>
        </section>

        <section className="panel image-panel">
          <div className="image-header">
            <div>
              <h2>Labeling focus</h2>
              <p className="muted">First unlocked image is loaded by default.</p>
            </div>
            <button
              className="ghost"
              onClick={() => selectedProjectId && loadAvailableQueue(selectedProjectId)}
              disabled={!selectedProjectId}
            >
              Reload queue
            </button>
          </div>

          {activeImage ? (
            <div className="image-body">
              <div className="preview">
                {activeImage.fileUrl ? (
                  <img src={activeImage.fileUrl} alt={activeImage.meta?.fileName} />
                ) : (
                  <div className="empty">No preview available</div>
                )}
              </div>
              <div className="details">
                <p className="filename">{activeImage.meta?.fileName}</p>
                <p className="muted">
                  {activeImage.meta?.width} x {activeImage.meta?.height} · {" "}
                  {activeImage.meta?.status}
                </p>
                <div className="pill-row">
                  {(activeImage.meta?.tags || []).length === 0 && (
                    <span className="pill">no tags</span>
                  )}
                  {(activeImage.meta?.tags || []).map((tag: string) => (
                    <span className="pill" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="queue">
                  <h3>Locked queue</h3>
                  {availableImages.length === 0 && (
                    <p className="muted">No unlocked images found.</p>
                  )}
                  {availableImages.map((image) => (
                    <button
                      key={image.imageId}
                      className={
                        image.imageId === activeImage.imageId
                          ? "queue-item active"
                          : "queue-item"
                      }
                      onClick={() => setActiveImageId(image.imageId)}
                    >
                      <span>{image.meta?.fileName || image.imageId}</span>
                      <small>{image.imageId}</small>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="empty">No images available to label.</div>
          )}
        </section>

        <section className="panel upload-panel">
          <h2>Upload image</h2>
          <div className="upload-grid">
            <label>
              File
              <input
                type="file"
                accept="image/*"
                onChange={(event) =>
                  handleFileChange(event.target.files?.[0] || null)
                }
              />
            </label>
            <label>
              Status
              <select
                value={uploadState.status}
                onChange={(event) =>
                  setUploadState((prev) => ({
                    ...prev,
                    status: event.target.value,
                  }))
                }
              >
                {statusOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tags
              <input
                type="text"
                value={uploadState.tags}
                onChange={(event) =>
                  setUploadState((prev) => ({
                    ...prev,
                    tags: event.target.value,
                  }))
                }
                placeholder="comma-separated"
              />
            </label>
            <label>
              Dimensions
              <input
                type="text"
                value={
                  uploadState.width && uploadState.height
                    ? `${uploadState.width} x ${uploadState.height}`
                    : ""
                }
                placeholder="auto"
                disabled
              />
            </label>
          </div>
          <button onClick={handleUpload} disabled={uploadState.uploading}>
            {uploadState.uploading ? "Uploading..." : "Upload"}
          </button>
        </section>
      </main>
    </div>
  );
}

export default App;
