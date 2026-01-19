import type { IncomingMessage } from "node:http";
import { WebSocketServer } from "ws";
import type { RawData, WebSocket } from "ws";

type ProgressStatus = "running" | "done" | "error";

type ProgressState = {
  uploadId: string;
  completed: number;
  total: number;
  status: ProgressStatus;
  error?: string;
  updatedAt: number;
  cleanupTimer?: NodeJS.Timeout;
};

const progressStore = new Map<string, ProgressState>();
const subscribers = new Map<string, Set<WebSocket>>();
const socketSubscriptions = new Map<WebSocket, Set<string>>();
const CLEANUP_MS = 10 * 60 * 1000;

const buildPayload = (state: ProgressState) => ({
  type: "progress",
  uploadId: state.uploadId,
  completed: state.completed,
  total: state.total,
  status: state.status,
  error: state.error,
});

const emitProgress = (uploadId: string) => {
  const state = progressStore.get(uploadId);
  if (!state) {
    return;
  }
  const payload = JSON.stringify(buildPayload(state));
  const sockets = subscribers.get(uploadId);
  if (!sockets || sockets.size === 0) {
    return;
  }
  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) {
      socket.send(payload);
    } else {
      sockets.delete(socket);
    }
  }
};

const scheduleCleanup = (uploadId: string) => {
  const state = progressStore.get(uploadId);
  if (!state) {
    return;
  }
  if (state.cleanupTimer) {
    clearTimeout(state.cleanupTimer);
  }
  state.cleanupTimer = setTimeout(() => {
    progressStore.delete(uploadId);
    const sockets = subscribers.get(uploadId);
    if (sockets) {
      for (const socket of sockets) {
        const subs = socketSubscriptions.get(socket);
        subs?.delete(uploadId);
        if (subs && subs.size === 0) {
          socketSubscriptions.delete(socket);
        }
      }
    }
    subscribers.delete(uploadId);
  }, CLEANUP_MS);
};

const subscribeSocket = (socket: WebSocket, uploadId: string) => {
  if (!uploadId) {
    return;
  }
  let sockets = subscribers.get(uploadId);
  if (!sockets) {
    sockets = new Set();
    subscribers.set(uploadId, sockets);
  }
  sockets.add(socket);

  let uploads = socketSubscriptions.get(socket);
  if (!uploads) {
    uploads = new Set();
    socketSubscriptions.set(socket, uploads);
  }
  uploads.add(uploadId);

  emitProgress(uploadId);
};

const unsubscribeSocket = (socket: WebSocket) => {
  const uploads = socketSubscriptions.get(socket);
  if (!uploads) {
    return;
  }
  for (const uploadId of uploads) {
    const sockets = subscribers.get(uploadId);
    sockets?.delete(socket);
    if (sockets && sockets.size === 0) {
      subscribers.delete(uploadId);
    }
  }
  socketSubscriptions.delete(socket);
};

const getRequestPath = (req: IncomingMessage) => {
  if (!req.url) {
    return null;
  }
  try {
    return new URL(req.url, "http://localhost").pathname;
  } catch {
    return req.url.split("?")[0] || null;
  }
};

const parseUploadIdFromRequest = (req: IncomingMessage) => {
  if (!req.url) {
    return null;
  }
  try {
    const url = new URL(req.url, "http://localhost");
    const uploadId = url.searchParams.get("uploadId");
    return uploadId || null;
  } catch {
    return null;
  }
};

export const attachProgressServer = (server: import("node:http").Server) => {
  const wss = new WebSocketServer({ noServer: true });
  const allowedPaths = new Set(["/api/progress", "/progress"]);

  server.on("upgrade", (req, socket, head) => {
    const path = getRequestPath(req);
    if (!path || !allowedPaths.has(path)) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (client) => {
      wss.emit("connection", client, req);
    });
  });

  wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
    const uploadId = parseUploadIdFromRequest(req);
    if (uploadId) {
      subscribeSocket(socket, uploadId);
    }

    socket.on("message", (data: RawData) => {
      if (!data) {
        return;
      }
      try {
        const message = JSON.parse(data.toString());
        if (message?.type === "subscribe" && typeof message.uploadId === "string") {
          subscribeSocket(socket, message.uploadId);
        }
      } catch {
        // Ignore malformed messages
      }
    });

    socket.on("close", () => {
      unsubscribeSocket(socket);
    });
  });

  return wss;
};

export const initProgress = (uploadId: string, total: number) => {
  const state: ProgressState = {
    uploadId,
    completed: 0,
    total: Math.max(1, total),
    status: "running",
    updatedAt: Date.now(),
  };
  progressStore.set(uploadId, state);
  emitProgress(uploadId);
};

export const incrementProgress = (uploadId: string, delta: number = 1) => {
  const state = progressStore.get(uploadId);
  if (!state) {
    return;
  }
  state.completed = Math.min(state.total, state.completed + delta);
  state.updatedAt = Date.now();
  emitProgress(uploadId);
};

export const finishProgress = (uploadId: string) => {
  const state = progressStore.get(uploadId);
  if (!state) {
    return;
  }
  state.status = "done";
  state.completed = state.total;
  state.updatedAt = Date.now();
  emitProgress(uploadId);
  scheduleCleanup(uploadId);
};

export const failProgress = (uploadId: string, error: string) => {
  const state = progressStore.get(uploadId);
  if (!state) {
    return;
  }
  state.status = "error";
  state.error = error;
  state.updatedAt = Date.now();
  emitProgress(uploadId);
  scheduleCleanup(uploadId);
};
