import { signInAnonymously } from "firebase/auth";
import { auth } from "../firebaseconfig";
import type {
  LockResponse,
  MaskApiItem,
  MaskMapApiItem,
  MaskOverlay,
  ProjectApiItem,
  ProjectImageApiItem,
  ProjectImagesApiResponse,
  ProjectsApiResponse,
  SparseColorMap,
  UploadZipResponse,
} from "../types";

const rawApiBase = (import.meta.env.VITE_API_BASE_URL || "").trim();
const apiBase = rawApiBase.replace(/\/$/, "");
const apiRoot = apiBase.endsWith("/api") ? apiBase : `${apiBase}/api`;

const ensureAuth = async () => {
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
};

const getAuthToken = async () => {
  await ensureAuth();
  const token = await auth.currentUser?.getIdToken();
  if (!token) {
    throw new Error("Unable to acquire auth token");
  }
  return token;
};

const getUserId = async () => {
  await ensureAuth();
  const uid = auth.currentUser?.uid;
  if (!uid) {
    throw new Error("Unable to resolve user id");
  }
  return uid;
};

const apiFetch = async (path: string, options: RequestInit = {}) => {
  if (!apiBase) {
    throw new Error("VITE_API_BASE_URL is not configured");
  }
  const token = await getAuthToken();
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${apiRoot}${path}`, {
    ...options,
    headers,
  });

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const message =
      typeof data === "object" && data && "message" in data
        ? String((data as { message: string }).message)
        : "Request failed";
    throw new Error(message);
  }

  return data;
};

export const listProjects = async () =>
  apiFetch("/projects", { method: "GET" }) as Promise<ProjectsApiResponse>;

export const createProject = async (payload: {
  name: string;
  description?: string | null;
  labels: Record<string, { labelId: string; name: string; color: string }>;
}) =>
  apiFetch("/projects", {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
  }) as Promise<{ projectId: string }>;

export const getProject = async (projectId: string) =>
  apiFetch(`/projects/${projectId}`, { method: "GET" }) as Promise<ProjectApiItem>;

export const deleteProject = async (projectId: string) =>
  apiFetch(`/projects/${projectId}`, { method: "DELETE" }) as Promise<{ projectId: string; deleted: boolean }>;

export const listImages = async (
  projectId: string,
  options: {
    limit?: number;
    status?: string;
    cursor?: string;
    includeTotal?: boolean;
    includeFileUrl?: boolean;
  } = {}
) => {
  const params = new URLSearchParams();
  if (options.limit) {
    params.set("limit", String(options.limit));
  }
  if (options.status) {
    params.set("status", options.status);
  }
  if (options.cursor) {
    params.set("cursor", options.cursor);
  }
  if (options.includeTotal) {
    params.set("includeTotal", "1");
  }
  if (options.includeFileUrl) {
    params.set("includeFileUrl", "1");
  }

  const query = params.toString();
  const path = query
    ? `/projects/${projectId}/images?${query}`
    : `/projects/${projectId}/images`;

  return apiFetch(path, { method: "GET" }) as Promise<ProjectImagesApiResponse>;
};

export const getImage = async (projectId: string, imageId: string) =>
  apiFetch(`/projects/${projectId}/images/${imageId}`, { method: "GET" }) as Promise<ProjectImageApiItem>;

export const getAvailableImages = async (
  projectId: string,
  options: { limit?: number; status?: string; includeFileUrl?: boolean } = {}
) => {
  const params = new URLSearchParams();
  if (options.limit) {
    params.set("limit", String(options.limit));
  }
  if (options.status) {
    params.set("status", options.status);
  }
  if (options.includeFileUrl !== false) {
    params.set("includeFileUrl", "1");
  }

  const query = params.toString();
  const path = query
    ? `/projects/${projectId}/images/available?${query}`
    : `/projects/${projectId}/images/available`;

  return apiFetch(path, { method: "GET" }) as Promise<ProjectImagesApiResponse>;
};

export const acquireLocks = async (
  projectId: string,
  imageIds: string[],
  durationMs?: number
) => {
  const userId = await getUserId();
  return apiFetch(`/projects/${projectId}/locks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageIds, userId, durationMs }),
  }) as Promise<LockResponse>;
};

export const releaseLocks = async (projectId: string, imageIds: string[]) => {
  const userId = await getUserId();
  return apiFetch(`/projects/${projectId}/locks`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageIds, userId }),
  }) as Promise<LockResponse>;
};

export const updateImage = async (
  projectId: string,
  imageId: string,
  payload: {
    meta?: {
      status?: string;
      tags?: string[];
    };
    maskMapId?: string | null;
    labelComplete?: boolean;
    reviewed?: boolean;
    labellerId?: string | null;
  }
) =>
  apiFetch(`/projects/${projectId}/images/${imageId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

export const uploadZipToBackend = async (
  projectId: string,
  file: File,
  meta: {
    status: string;
    tags?: string[];
  }
) => {
  const token = await getAuthToken();
  const form = new FormData();
  form.append("zipData", file);
  form.append("meta", JSON.stringify(meta));

  const response = await fetch(`${apiRoot}/projects/${projectId}/images/zip`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  });

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const message =
      typeof data === "object" && data && "message" in data
        ? String((data as { message: string }).message)
        : "Upload failed";
    throw new Error(message);
  }

  return data as UploadZipResponse;
};

// ============================================================================
// MASK API FUNCTIONS
// ============================================================================

/**
 * Get masks and maskMap for an image
 */
export const getImageMasks = async (projectId: string, imageId: string) =>
  apiFetch(`/projects/${projectId}/images/${imageId}/masks`, {
    method: "GET",
  }) as Promise<{ masks: MaskApiItem[]; maskMap: MaskMapApiItem | null }>;

/**
 * Get a specific mask map
 */
export const getMaskMap = async (projectId: string, maskMapId: string) =>
  apiFetch(`/projects/${projectId}/maskmaps/${maskMapId}`, {
    method: "GET",
  }) as Promise<MaskMapApiItem>;

/**
 * Get colorMap from storage for a mask map
 */
export const getColorMap = async (projectId: string, maskMapId: string) =>
  apiFetch(`/projects/${projectId}/maskmaps/${maskMapId}/colormap`, {
    method: "GET",
  }) as Promise<SparseColorMap>;

/**
 * Get maskOverlay from storage for a mask map (by maskMapId)
 * Returns the 2D array where each pixel contains the maskId of the smallest mask
 */
export const getMaskOverlay = async (projectId: string, maskMapId: string) =>
  apiFetch(`/projects/${projectId}/maskmaps/${maskMapId}/maskoverlay`, {
    method: "GET",
  }) as Promise<MaskOverlay | null>;

/**
 * Get maskOverlay for an image (by imageId)
 * This is the preferred method - simpler to use since you only need the imageId
 * Returns the 2D array where each pixel contains the maskId of the smallest mask
 */
export const getImageMaskOverlay = async (projectId: string, imageId: string) =>
  apiFetch(`/projects/${projectId}/images/${imageId}/maskoverlay`, {
    method: "GET",
  }) as Promise<MaskOverlay | null>;

/**
 * Update a single mask's label
 */
export const updateMaskLabel = async (
  projectId: string,
  maskId: string,
  labelId: string | null
) =>
  apiFetch(`/projects/${projectId}/masks/${maskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ labelId }),
  }) as Promise<{ maskId: string; labelId: string | null; color: string | null }>;

/**
 * Batch update multiple masks' labels
 */
export const batchUpdateMaskLabels = async (
  projectId: string,
  updates: Array<{ maskId: string; labelId: string | null }>
) =>
  apiFetch(`/projects/${projectId}/masks`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ updates }),
  }) as Promise<{
    results: Array<{
      maskId: string;
      success: boolean;
      labelId?: string | null;
      color?: string | null;
      error?: string;
    }>;
  }>;
