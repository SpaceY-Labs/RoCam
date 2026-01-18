import { signInAnonymously } from "firebase/auth";
import { auth } from "../firebaseconfig";
import type {
  LockResponse,
  ProjectApiItem,
  ProjectImagesApiResponse,
  ProjectsApiResponse,
  SegmentResponse,
  UploadImageResponse,
} from "../types";

const apiBase = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

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

  const response = await fetch(`${apiBase}${path}`, {
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
  classes: { id: string; name: string; color: string }[];
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

  const query = params.toString();
  const path = query
    ? `/projects/${projectId}/images?${query}`
    : `/projects/${projectId}/images`;

  return apiFetch(path, { method: "GET" }) as Promise<ProjectImagesApiResponse>;
};

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
    masks?: {
      id: string;
      classId: string;
      className: string;
      color: string;
      polygon?: { x: number; y: number }[][];
      rle?: { counts: string; size: [number, number] };
      boundingBox?: { x: number; y: number; w: number; h: number };
      source: string;
    }[];
    labellerId?: string | null;
  }
) =>
  apiFetch(`/projects/${projectId}/images/${imageId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

export const segmentImage = async (payload: {
  projectId: string;
  imageId: string;
  mode: "click" | "auto";
  resourceUrl?: string;
  points?: { x: number; y: number; label: 0 | 1 }[];
  prompt?: string;
}) => {
  const startResponse = await apiFetch("/segment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "start_session",
      projectId: payload.projectId,
      imageId: payload.imageId,
      ...(payload.resourceUrl ? { resourceUrl: payload.resourceUrl } : {}),
    }),
  });

  const sessionId =
    (startResponse as { session_id?: string }).session_id ||
    (startResponse as { sessionId?: string }).sessionId ||
    (startResponse as { session?: string }).session;

  if (!sessionId) {
    throw new Error("SAM3 session_id missing");
  }

  try {
    const addPrompt: Record<string, unknown> = {
      type: "add_prompt",
      session_id: sessionId,
      frame_index: 0,
    };

    if (payload.mode === "click") {
      if (!payload.points || payload.points.length === 0) {
        throw new Error("SAM3 click mode requires points");
      }
      addPrompt.points = payload.points.map((point) => [point.x, point.y]);
      addPrompt.point_labels = payload.points.map((point) => point.label);
      addPrompt.obj_id = 1;
    } else {
      const text = payload.prompt?.trim() || "object";
      addPrompt.text = text;
    }

    const response = await apiFetch("/segment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(addPrompt),
    });

    const outputs = (response as { outputs?: SegmentResponse }).outputs;
    const masks =
      outputs?.masks ||
      (response as SegmentResponse).masks ||
      [];

    return { masks } as SegmentResponse;
  } finally {
    try {
      await apiFetch("/segment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "close_session",
          session_id: sessionId,
        }),
      });
    } catch (error) {
      void error;
    }
  }
};

export const uploadImageToBackend = async (
  projectId: string,
  file: File,
  meta: {
    fileName: string;
    width: number;
    height: number;
    status: string;
    tags?: string[];
  }
) => {
  const token = await getAuthToken();
  const form = new FormData();
  form.append("imageData", file);
  form.append("meta", JSON.stringify(meta));

  const response = await fetch(`${apiBase}/projects/${projectId}/images`, {
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

  return data as UploadImageResponse;
};
