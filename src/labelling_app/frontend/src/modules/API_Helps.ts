import { signInAnonymously } from "firebase/auth";
import { auth } from "../firebaseconfig";

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
  apiFetch("/projects", { method: "GET" }) as Promise<{ items: any[] }>;

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
  apiFetch(`/projects/${projectId}`, { method: "GET" }) as Promise<any>;

export const listImages = async (projectId: string) =>
  apiFetch(`/projects/${projectId}/images`, {
    method: "GET",
  }) as Promise<{ items: any[] }>;

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

  return apiFetch(path, { method: "GET" }) as Promise<{ items: any[] }>;
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
  }) as Promise<{ results: any[] }>;
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

  return data as { imageId: string };
};
