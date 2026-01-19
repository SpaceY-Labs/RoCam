import { signInAnonymously } from "firebase/auth";
import { auth } from "../firebaseconfig";
import type {
  LockResponse,
  ProjectApiItem,
  ProjectImageApiItem,
  ProjectImagesApiResponse,
  ProjectsApiResponse,
  SegmentMask,
  SegmentResponse,
  UploadImageResponse,
  UploadZipResponse,
  MaskTensor,
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
    masks?: {
      id: string;
      classId: string;
      className: string;
      color: string;
      mask?: (0 | 1 | boolean)[][];
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
  mode: "auto";
  prompt?: string;
}) => {
  const isMaskTensor = (mask: unknown): mask is MaskTensor =>
    Array.isArray(mask) && mask.length > 0 && mask.every((row) => Array.isArray(row));

  const normalizeMaskRows = (rows: unknown[][]): MaskTensor =>
    rows.map((row) =>
      Array.isArray(row)
        ? row.map((value) => (value ? 1 : 0) as 0 | 1)
        : []
    );

  const getMaskArea = (mask: MaskTensor) =>
    mask.reduce<number>(
      (sum, row) =>
        sum +
        row.reduce<number>(
          (rowSum, value) => rowSum + (value ? 1 : 0),
          0
        ),
      0
    );

  const getStoredMasks = async () => {
    if (!payload.projectId || !payload.imageId) {
      return [];
    }
    const image = await getImage(payload.projectId, payload.imageId);
    if (!Array.isArray(image.masks)) {
      return [];
    }
    return image.masks.flatMap((mask) => {
      if (!mask.mask || !mask.boundingBox) {
        return [];
      }
      const normalized = normalizeMaskRows(mask.mask as unknown[][]);
      return [{
        mask: normalized,
        boundingBox: mask.boundingBox,
        area: getMaskArea(normalized),
        score: 1,
      }];
    });
  };

  const fetchMaskChunk = async (chunkId: string, startRow: number) =>
    apiFetch(`/segment/chunks/${chunkId}?startRow=${startRow}`, { method: "GET" }) as Promise<{
      chunkId: string;
      startRow: number;
      rows: unknown[][];
      nextRow: number;
      done: boolean;
      totalRows: number;
    }>;

  const resolveChunkedMask = async (
    rawMask: Record<string, unknown>
  ): Promise<SegmentMask | null> => {
    const chunkId = rawMask.maskChunkId;
    const chunk = rawMask.maskChunk;
    if (typeof chunkId !== "string" || !chunk || typeof chunk !== "object") {
      return null;
    }

    const typedChunk = chunk as { startRow?: unknown; rows?: unknown };
    const initialRows = Array.isArray(typedChunk.rows) ? (typedChunk.rows as unknown[][]) : [];
    const startRow =
      typeof typedChunk.startRow === "number" && Number.isFinite(typedChunk.startRow)
        ? typedChunk.startRow
        : 0;

    const rows: MaskTensor = [];
    if (initialRows.length > 0) {
      const normalized = normalizeMaskRows(initialRows);
      for (let i = 0; i < normalized.length; i += 1) {
        rows[startRow + i] = normalized[i];
      }
    }

    let nextRow = startRow + initialRows.length;
    let done = false;
    while (!done) {
      const nextChunk = await fetchMaskChunk(chunkId, nextRow);
      if (!Array.isArray(nextChunk.rows) || nextChunk.rows.length === 0) {
        break;
      }
      const normalized = normalizeMaskRows(nextChunk.rows);
      for (let i = 0; i < normalized.length; i += 1) {
        rows[nextChunk.startRow + i] = normalized[i];
      }
      nextRow = nextChunk.nextRow;
      done = Boolean(nextChunk.done);
    }

    return {
      mask: rows,
      boundingBox: rawMask.boundingBox as SegmentMask["boundingBox"],
      area: Number(rawMask.area) || 0,
      score: Number(rawMask.score) || 0,
    };
  };

  const requestBody: Record<string, unknown> = {
    mode: payload.mode,
  };

  requestBody.projectId = payload.projectId;
  requestBody.imageId = payload.imageId;

  if (payload.prompt?.trim()) {
    requestBody.prompt = payload.prompt.trim();
  }

  const response = await apiFetch("/segment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  const outputs = (response as { outputs?: SegmentResponse }).outputs;
  const rawMasks =
    (outputs && (outputs as SegmentResponse).masks) ||
    (response as SegmentResponse).masks ||
    [];

  const resolvedMasks: SegmentMask[] = [];
  for (const rawMask of rawMasks as unknown[]) {
    if (!rawMask || typeof rawMask !== "object") {
      continue;
    }
    const typedMask = rawMask as Record<string, unknown>;
    if (isMaskTensor(typedMask.mask)) {
      resolvedMasks.push({
        mask: typedMask.mask,
        boundingBox: typedMask.boundingBox as SegmentMask["boundingBox"],
        area: Number(typedMask.area) || 0,
        score: Number(typedMask.score) || 0,
      });
      continue;
    }

    const chunked = await resolveChunkedMask(typedMask);
    if (chunked) {
      resolvedMasks.push(chunked);
    }
  }

  if (resolvedMasks.length > 0) {
    return { masks: resolvedMasks } as SegmentResponse;
  }

  const storedMasks = await getStoredMasks();
  return { masks: storedMasks } as SegmentResponse;
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
  },
  uploadId?: string
) => {
  const token = await getAuthToken();
  const form = new FormData();
  form.append("imageData", file);
  form.append("meta", JSON.stringify(meta));
  if (uploadId) {
    form.append("uploadId", uploadId);
  }

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

export const uploadZipToBackend = async (
  projectId: string,
  file: File,
  meta: {
    status: string;
    tags?: string[];
  },
  uploadId?: string
) => {
  const token = await getAuthToken();
  const form = new FormData();
  form.append("zipData", file);
  form.append("meta", JSON.stringify(meta));
  if (uploadId) {
    form.append("uploadId", uploadId);
  }

  const response = await fetch(`${apiBase}/projects/${projectId}/images/zip`, {
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
