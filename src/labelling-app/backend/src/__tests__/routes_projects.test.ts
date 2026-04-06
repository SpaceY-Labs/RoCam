/**
 * Author: Xiaotian Lou
 * Date: 2026-03-04
 * Purpose: Integration tests for project CRUD and image management routes.
 */
/**
 * Integration tests for src/routes/projects.ts
 *
 * Uses supertest against a minimal Express app that mounts the projects router.
 * All external services (Firestore, Storage, Image, Masks) are mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { Request, Response, NextFunction } from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  firestoreMock,
  fieldValueMock,
  timestampMock,
  storageMock,
  authMock,
} = vi.hoisted(() => {
  const docRefMock: Record<string, unknown> = {
    id: "proj-new-id",
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const collectionRefMock = {
    doc: vi.fn().mockReturnValue(docRefMock),
    orderBy: vi.fn().mockReturnThis(),
    get: vi.fn().mockResolvedValue({ docs: [] }),
  };
  const firestoreMock = {
    collection: vi.fn().mockReturnValue(collectionRefMock),
  };
  const fieldValueMock = { serverTimestamp: vi.fn().mockReturnValue("ts") };
  const timestampMock = { now: vi.fn() };
  const storageMock = { bucket: vi.fn().mockReturnValue({}) };
  const authMock = { verifyIdToken: vi.fn() };
  return { firestoreMock, fieldValueMock, timestampMock, storageMock, authMock };
});

vi.mock("../firebase", () => ({
  firestore: firestoreMock,
  FieldValue: fieldValueMock,
  Timestamp: timestampMock,
  storage: storageMock,
  auth: authMock,
}));

vi.mock("../config", () => ({
  config: {
    maxImageMb: 50,
    requireAuth: false,
    cacheColorMapMb: 32,
    cacheMaskOverlayMb: 64,
    cacheMaskBinaryMb: 64,
    cacheColorMapTtlMs: 300000,
    cacheMaskOverlayTtlMs: 300000,
    cacheMaskBinaryTtlMs: 300000,
    storageSignedUrlTtlMs: 300000,
  },
}));

vi.mock("../services/storage", () => ({
  uploadImageBuffer: vi.fn().mockResolvedValue({}),
  deleteFileIfExists: vi.fn().mockResolvedValue(undefined),
  getFileMetadata: vi.fn().mockResolvedValue({ size: 100 }),
  getFileStream: vi.fn().mockResolvedValue(null),
  getSignedReadUrl: vi.fn().mockResolvedValue("https://signed-url"),
  uploadMaskBuffer: vi.fn().mockResolvedValue(undefined),
  downloadMaskBuffer: vi.fn().mockResolvedValue(Buffer.from([0])),
  buildMaskStoragePath: vi.fn((p: string, i: string, m: string) => `${p}/${i}/${m}.bin`),
  buildColorMapStoragePath: vi.fn((p: string, m: string) => `${p}/${m}/colormap.json`),
  buildMaskOverlayStoragePath: vi.fn((p: string, m: string) => `${p}/${m}/overlay.json`),
  uploadColorMap: vi.fn().mockResolvedValue(undefined),
  downloadColorMap: vi.fn().mockResolvedValue({}),
  uploadMaskOverlay: vi.fn().mockResolvedValue(undefined),
  downloadMaskOverlay: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/image", () => ({
  resizeImageBuffer: vi.fn().mockResolvedValue({
    buffer: Buffer.from("resized"),
    contentType: "image/jpeg",
    width: 1920,
    height: 1080,
    format: "jpeg",
  }),
  TARGET_WIDTH: 1920,
  TARGET_HEIGHT: 1080,
}));

vi.mock("../services/projects", () => ({
  ensureProjectAccess: vi.fn().mockResolvedValue({
    exists: true,
    id: "proj-1",
    data: () => ({
      name: "Test Project",
      description: "A description",
      labels: {},
      imageIds: [],
    }),
    ref: { set: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(undefined) },
  }),
  getProjectImagesCollection: vi.fn().mockReturnValue({
    get: vi.fn().mockResolvedValue({ docs: [] }),
    doc: vi.fn().mockReturnValue({
      get: vi.fn().mockResolvedValue({ exists: false }),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      id: "img-1",
    }),
    add: vi.fn().mockResolvedValue({ id: "img-new" }),
    orderBy: vi.fn().mockReturnThis(),
  }),
  getProjectLocksCollection: vi.fn().mockReturnValue({
    get: vi.fn().mockResolvedValue({ docs: [] }),
    doc: vi.fn().mockReturnValue({
      get: vi.fn().mockResolvedValue({ exists: false }),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    }),
  }),
  getProjectMasksCollection: vi.fn().mockReturnValue({
    get: vi.fn().mockResolvedValue({ docs: [] }),
    doc: vi.fn().mockReturnValue({
      get: vi.fn().mockResolvedValue({ exists: false }),
      set: vi.fn().mockResolvedValue(undefined),
    }),
  }),
  getProjectMaskMapsCollection: vi.fn().mockReturnValue({
    get: vi.fn().mockResolvedValue({ docs: [] }),
    doc: vi.fn().mockReturnValue({
      get: vi.fn().mockResolvedValue({ exists: false }),
      set: vi.fn().mockResolvedValue(undefined),
    }),
  }),
  getProjectDoc: vi.fn(),
}));

// Mock the shared workspace package (Zod schemas)
vi.mock("shared", () => {
  const z = { object: (shape: unknown) => ({ safeParse: vi.fn(), parse: vi.fn(), pick: vi.fn().mockReturnThis(), optional: vi.fn().mockReturnThis() }) };
  const makeSchema = () => ({
    safeParse: vi.fn((data: unknown) => {
      if (!data || typeof data !== "object") return { success: false, error: { message: "invalid" } };
      return { success: true, data };
    }),
    parse: vi.fn((data: unknown) => data),
    pick: vi.fn().mockReturnThis(),
    optional: vi.fn().mockReturnThis(),
  });
  return {
    projectCreateSchema: {
      safeParse: vi.fn((data: unknown) => {
        const d = data as Record<string, unknown>;
        if (!d || !d.name || typeof d.name !== "string") {
          return { success: false, error: { message: "name required" } };
        }
        return { success: true, data: d };
      }),
    },
    projectUpdateSchema: {
      safeParse: vi.fn((data: unknown) => {
        if (!data || typeof data !== "object" || typeof (data as Record<string, unknown>)["name"] === "number") {
          return { success: false, error: { message: "invalid" } };
        }
        return { success: true, data };
      }),
    },
    imageMetaSchema: { pick: vi.fn().mockReturnValue({ safeParse: vi.fn((d: unknown) => ({ success: true, data: d })) }) },
    imageUpdateSchema: makeSchema(),
    lockAcquireSchema: {
      safeParse: vi.fn((data: unknown) => {
        const d = data as Record<string, unknown>;
        if (!d || !d.lockToken) return { success: false, error: { message: "lockToken required" } };
        return { success: true, data };
      }),
    },
    lockReleaseSchema: {
      safeParse: vi.fn((data: unknown) => {
        const d = data as Record<string, unknown>;
        if (!d || !d.lockToken) return { success: false, error: { message: "lockToken required" } };
        return { success: true, data };
      }),
    },
    maskUpdateSchema: makeSchema(),
    maskBatchUpdateSchema: makeSchema(),
    zipUploadMetaSchema: makeSchema(),
  };
});

vi.mock("../services/masks", () => ({
  parseFeatherMask: vi.fn().mockReturnValue(null),
  getBaseName: vi.fn((fp: string) => fp.split(".")[0]),
  getMaskImageBaseName: vi.fn((fp: string) => fp.split("_")[0]),
  prepareMaskFromParsed: vi.fn(),
  createMaskMapFromMasks: vi.fn(),
  computeColorMap: vi.fn().mockReturnValue({}),
  rawBinaryToSparseMask: vi.fn().mockReturnValue({}),
  generateMaskOverlay: vi.fn().mockReturnValue({ width: 0, height: 0, maskIds: [], data: [] }),
}));

// ---------------------------------------------------------------------------
// Build test app
// ---------------------------------------------------------------------------
const buildApp = async () => {
  // Dynamically import router after mocks are set up
  const { default: projectsRouter } = await import("../routes/projects");
  const { errorHandler } = await import("../middleware/error");

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Inject fake authenticated user middleware
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as Record<string, unknown>).user = { uid: "test-uid", email: "test@example.com" };
    next();
  });

  app.use("/projects", projectsRouter);
  app.use(errorHandler);
  return app;
};

// ---------------------------------------------------------------------------
// Project CRUD tests
// ---------------------------------------------------------------------------
describe("POST /projects", () => {
  it("creates a project and returns 201 with projectId", async () => {
    const app = await buildApp();
    const res = await request(app)
      .post("/projects")
      .send({ name: "New Project", labels: {} });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("projectId");
  });

  it("returns 400 when name is missing", async () => {
    const app = await buildApp();
    const res = await request(app).post("/projects").send({});
    expect(res.status).toBe(400);
  });
});

describe("GET /projects", () => {
  it("returns 200 with items array", async () => {
    const { firestore } = await import("../firebase");
    vi.mocked(firestore.collection("projects").orderBy("createdAt", "desc").get).mockResolvedValue({
      docs: [
        { id: "p1", data: () => ({ name: "Project 1", description: null, labels: {} }) },
      ],
    } as unknown as FirebaseFirestore.QuerySnapshot);

    const app = await buildApp();
    const res = await request(app).get("/projects");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("items");
  });
});

describe("GET /projects/:projectId", () => {
  it("returns 200 with project data", async () => {
    const app = await buildApp();
    const res = await request(app).get("/projects/proj-1");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("projectId", "proj-1");
  });

  it("returns 404 when project does not exist", async () => {
    const { ensureProjectAccess } = await import("../services/projects");
    const { HttpError } = await import("../middleware/error");
    vi.mocked(ensureProjectAccess).mockRejectedValueOnce(
      new HttpError(404, "NOT_FOUND", "Project not found")
    );
    const app = await buildApp();
    const res = await request(app).get("/projects/missing-proj");
    expect(res.status).toBe(404);
  });
});

describe("PATCH /projects/:projectId", () => {
  it("updates a project and returns 200 with projectId", async () => {
    const app = await buildApp();
    const res = await request(app)
      .patch("/projects/proj-1")
      .send({ name: "Updated Name" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("projectId");
  });

  it("returns 400 when no fields to update", async () => {
    const app = await buildApp();
    const res = await request(app)
      .patch("/projects/proj-1")
      .send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 when body has invalid schema", async () => {
    const app = await buildApp();
    const res = await request(app)
      .patch("/projects/proj-1")
      .send({ name: 12345 }); // name should be string
    expect(res.status).toBe(400);
  });
});

describe("DELETE /projects/:projectId", () => {
  it("deletes a project and returns 200", async () => {
    const app = await buildApp();
    const res = await request(app).delete("/projects/proj-1");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ projectId: "proj-1", deleted: true });
  });
});

// ---------------------------------------------------------------------------
// Image list route
// ---------------------------------------------------------------------------
describe("GET /projects/:projectId/images", () => {
  it("returns 200 with images list", async () => {
    const { getProjectImagesCollection } = await import("../services/projects");
    vi.mocked(getProjectImagesCollection).mockReturnValueOnce({
      orderBy: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      startAfter: vi.fn().mockReturnThis(),
      count: vi.fn().mockReturnThis(),
      doc: vi.fn(),
      get: vi.fn().mockResolvedValue({ docs: [], length: 0 }),
    } as unknown as ReturnType<typeof getProjectImagesCollection>);

    const app = await buildApp();
    const res = await request(app).get("/projects/proj-1/images");
    expect([200]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// ZIP upload route
// ---------------------------------------------------------------------------
describe("POST /projects/:projectId/images/zip", () => {
  it("returns 400 when no file uploaded", async () => {
    const app = await buildApp();
    const res = await request(app)
      .post("/projects/proj-1/images/zip")
      .field("meta", JSON.stringify({ status: "unlabeled" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when uploaded file is not a zip", async () => {
    const app = await buildApp();
    const res = await request(app)
      .post("/projects/proj-1/images/zip")
      .attach("zipData", Buffer.from("not a zip"), { filename: "file.txt", contentType: "text/plain" })
      .field("meta", JSON.stringify({ status: "unlabeled" }));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Lock routes (POST /:projectId/locks, DELETE /:projectId/locks)
// ---------------------------------------------------------------------------
describe("POST /projects/:projectId/locks", () => {
  it("returns 400 when body fails lockAcquireSchema", async () => {
    const app = await buildApp();
    const res = await request(app)
      .post("/projects/proj-1/locks")
      .send({}); // missing lockToken/imageIds
    expect(res.status).toBe(400);
  });
});

describe("DELETE /projects/:projectId/locks", () => {
  it("returns 400 when body fails lockReleaseSchema", async () => {
    const app = await buildApp();
    const res = await request(app)
      .delete("/projects/proj-1/locks")
      .send({}); // missing required fields
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Auth guard (no user)
// ---------------------------------------------------------------------------
describe("routes without auth context", () => {
  it("returns 401 when user is missing from request", async () => {
    const { default: projectsRouter } = await import("../routes/projects");
    const { errorHandler } = await import("../middleware/error");

    const app = express();
    app.use(express.json());
    // No user injection middleware
    app.use("/projects", projectsRouter);
    app.use(errorHandler);

    const res = await request(app).post("/projects").send({ name: "Project" });
    expect(res.status).toBe(401);
  });
});
