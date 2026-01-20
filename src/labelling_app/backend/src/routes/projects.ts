import path from "node:path";
import { Router } from "express";
import multer from "multer";
import AdmZip from "adm-zip";
import { v4 as uuidv4 } from "uuid";
import { firestore, FieldValue, Timestamp } from "../firebase";
import { asyncHandler } from "../middleware/asyncHandler";
import { HttpError } from "../middleware/error";
import type { AuthenticatedRequest } from "../middleware/auth";
import {
  imageUpdateSchema,
  imageMetaSchema,
  lockAcquireSchema,
  lockReleaseSchema,
  projectCreateSchema,
  projectUpdateSchema,
} from "shared";
import { config } from "../config";
import {
  deleteFileIfExists,
  getFileMetadata,
  getFileStream,
  getSignedReadUrl,
  uploadImageBuffer,
} from "../services/storage";
import { resizeImageBuffer, TARGET_HEIGHT, TARGET_WIDTH } from "../services/image";
import {
  ensureProjectAccess,
  getProjectImagesCollection,
  getProjectLocksCollection,
} from "../services/projects";
import {
  normalizeMasksForResponse,
  serializeMasksForStorage,
} from "../services/masks";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxImageMb * 1024 * 1024 },
});

const parseJsonField = <T>(value: string | undefined, fieldName: string): T => {
  if (!value) {
    throw new HttpError(400, "VALIDATION_ERROR", `${fieldName} is required`);
  }
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new HttpError(400, "VALIDATION_ERROR", `${fieldName} must be valid JSON`);
  }
};

const buildStoragePath = (projectId: string, imageId: string, fileName: string) =>
  `projects/${projectId}/images/${imageId}/${fileName}`;

const normalizeImageData = (data: FirebaseFirestore.DocumentData) =>
  ({ ...data, masks: normalizeMasksForResponse(data.masks) } as FirebaseFirestore.DocumentData);

const zipMetaSchema = imageMetaSchema.pick({ status: true, tags: true });
const buildImageMeta = (
  meta: { fileName: string; status: string; tags?: string[] },
  fileNameOverride?: string
) => ({
  fileName: fileNameOverride || meta.fileName,
  width: TARGET_WIDTH,
  height: TARGET_HEIGHT,
  status: meta.status,
  tags: meta.tags || [],
});

router.post(
  "/",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      throw new HttpError(401, "UNAUTHORIZED", "Missing auth context");
    }

    const parsed = projectCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "VALIDATION_ERROR", parsed.error.message);
    }

    const docRef = firestore.collection("projects").doc();
    const projectId = docRef.id;

    await docRef.set({
      projectId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      classes: parsed.data.classes,
      ownerUid: user.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    res.status(201).json({ projectId });
  })
);

router.get(
  "/",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      throw new HttpError(401, "UNAUTHORIZED", "Missing auth context");
    }

    const snapshot = await firestore
      .collection("projects")
      .orderBy("createdAt", "desc")
      .get();

    const items = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        projectId: doc.id,
        name: data.name,
        description: data.description ?? null,
      };
    });

    res.json({ items });
  })
);

router.get(
  "/:projectId",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      throw new HttpError(401, "UNAUTHORIZED", "Missing auth context");
    }

    const projectId = req.params.projectId;
    const doc = await ensureProjectAccess(projectId, user.uid);
    const data = doc.data();

    res.json({
      projectId: doc.id,
      name: data?.name,
      description: data?.description ?? null,
      classes: data?.classes ?? [],
    });
  })
);

router.patch(
  "/:projectId",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      throw new HttpError(401, "UNAUTHORIZED", "Missing auth context");
    }

    const projectId = req.params.projectId;
    const doc = await ensureProjectAccess(projectId, user.uid);

    const parsed = projectUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "VALIDATION_ERROR", parsed.error.message);
    }

    if (Object.keys(parsed.data).length === 0) {
      throw new HttpError(400, "VALIDATION_ERROR", "No fields to update");
    }

    await doc.ref.set(
      {
        ...parsed.data,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    res.json({ projectId: doc.id });
  })
);

router.delete(
  "/:projectId",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      throw new HttpError(401, "UNAUTHORIZED", "Missing auth context");
    }

    const projectId = req.params.projectId;
    const doc = await ensureProjectAccess(projectId, user.uid);

    const imagesCollection = getProjectImagesCollection(projectId);
    const imagesSnapshot = await imagesCollection.get();
    for (const imageDoc of imagesSnapshot.docs) {
      const data = imageDoc.data();
      if (data?.storagePath) {
        await deleteFileIfExists(data.storagePath);
      }
      await imageDoc.ref.delete();
    }

    const locksCollection = getProjectLocksCollection(projectId);
    const locksSnapshot = await locksCollection.get();
    await Promise.all(locksSnapshot.docs.map((lockDoc) => lockDoc.ref.delete()));

    await doc.ref.delete();

    res.json({ projectId, deleted: true });
  })
);

router.post(
  "/:projectId/images",
  upload.single("imageData"),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      throw new HttpError(401, "UNAUTHORIZED", "Missing auth context");
    }

    const projectId = req.params.projectId;
    await ensureProjectAccess(projectId, user.uid);

    const file = req.file;
    if (!file) {
      throw new HttpError(400, "VALIDATION_ERROR", "imageData is required");
    }

    const meta = imageMetaSchema.safeParse(
      parseJsonField(req.body.meta, "meta")
    );

    if (!meta.success) {
      throw new HttpError(400, "VALIDATION_ERROR", meta.error.message);
    }

    const imageId = req.body.imageId || uuidv4();
    const videoId = req.body.videoId ?? null;
    const labellerId = req.body.labellerId ?? null;

    try {
      const resized = await resizeImageBuffer(file.buffer);

      const storagePath = buildStoragePath(projectId, imageId, meta.data.fileName);

      await uploadImageBuffer(storagePath, resized.buffer, resized.contentType);

      await getProjectImagesCollection(projectId).doc(imageId).set(
        {
          imageId,
          projectId,
          videoId,
          masks: [],
          labellerId,
          meta: buildImageMeta(meta.data),
          storagePath,
          contentType: resized.contentType,
          sizeBytes: resized.buffer.length,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      res.status(201).json({ imageId });
    } catch (error) {
      throw error;
    }
  })
);

router.post(
  "/:projectId/images/zip",
  upload.single("zipData"),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      throw new HttpError(401, "UNAUTHORIZED", "Missing auth context");
    }

    const projectId = req.params.projectId;
    await ensureProjectAccess(projectId, user.uid);

    const file = req.file;
    if (!file) {
      throw new HttpError(400, "VALIDATION_ERROR", "zipData is required");
    }
    const isZip =
      file.mimetype.includes("zip") ||
      file.originalname.toLowerCase().endsWith(".zip");
    if (!isZip) {
      throw new HttpError(400, "VALIDATION_ERROR", "zipData must be a zip file");
    }

    const meta = zipMetaSchema.safeParse(parseJsonField(req.body.meta, "meta"));
    if (!meta.success) {
      throw new HttpError(400, "VALIDATION_ERROR", meta.error.message);
    }

    const zip = new AdmZip(file.buffer);
    const entries = zip.getEntries().filter((entry: { isDirectory: boolean }) => !entry.isDirectory);
    if (entries.length === 0) {
      throw new HttpError(400, "VALIDATION_ERROR", "Zip archive is empty");
    }

    const prepared: Array<{
      fileName: string;
      resized: { buffer: Buffer; contentType: string };
    }> = [];

    try {
      for (const entry of entries) {
        const fileName = path.basename(entry.entryName);
        if (!fileName) {
          throw new HttpError(400, "VALIDATION_ERROR", "Zip entry name is invalid");
        }
        const data = entry.getData();
        const resized = await resizeImageBuffer(data);
        prepared.push({ fileName, resized: { buffer: resized.buffer, contentType: resized.contentType } });
      }
    } catch (error) {
      throw error;
    }

    const saved: Array<{ imageId: string; storagePath: string }> = [];

    try {
      for (const item of prepared) {
        const imageId = uuidv4();
        const storagePath = buildStoragePath(projectId, imageId, item.fileName);

        await uploadImageBuffer(storagePath, item.resized.buffer, item.resized.contentType);

        await getProjectImagesCollection(projectId).doc(imageId).set(
          {
            imageId,
            projectId,
            videoId: null,
            masks: [],
            labellerId: null,
            meta: buildImageMeta(
              {
                fileName: item.fileName,
                status: meta.data.status,
                tags: meta.data.tags,
              },
              item.fileName
            ),
            storagePath,
            contentType: item.resized.contentType,
            sizeBytes: item.resized.buffer.length,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        saved.push({ imageId, storagePath });
      }
    } catch (error) {
      await Promise.allSettled(
        saved.map(async (item) => {
          await deleteFileIfExists(item.storagePath);
          await getProjectImagesCollection(projectId).doc(item.imageId).delete();
        })
      );
      throw error;
    }

    res.status(201).json({ imageIds: saved.map((item) => item.imageId), count: saved.length });
  })
);

router.patch(
  "/:projectId/images/:imageId",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      throw new HttpError(401, "UNAUTHORIZED", "Missing auth context");
    }

    const { projectId, imageId } = req.params;
    await ensureProjectAccess(projectId, user.uid);

    const parsed = imageUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "VALIDATION_ERROR", parsed.error.message);
    }

    const imageRef = getProjectImagesCollection(projectId).doc(imageId);
    const imageDoc = await imageRef.get();
    if (!imageDoc.exists) {
      throw new HttpError(404, "NOT_FOUND", "Image not found");
    }

    const updates: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (parsed.data.videoId !== undefined) {
      updates.videoId = parsed.data.videoId;
    }
    if (parsed.data.masks !== undefined) {
      updates.masks = serializeMasksForStorage(parsed.data.masks);
    }
    if (parsed.data.labellerId !== undefined) {
      updates.labellerId = parsed.data.labellerId;
    }
    if (parsed.data.meta) {
      for (const [key, value] of Object.entries(parsed.data.meta)) {
        if (value !== undefined) {
          updates[`meta.${key}`] = value;
        }
      }
    }

    await imageRef.update(updates);

    res.json({ imageId });
  })
);

router.get(
  "/:projectId/images",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      throw new HttpError(401, "UNAUTHORIZED", "Missing auth context");
    }

    const projectId = req.params.projectId;
    await ensureProjectAccess(projectId, user.uid);

    const ids = req.query.ids ? String(req.query.ids).split(",") : null;
    const status = req.query.status ? String(req.query.status) : null;
    const videoId = req.query.videoId ? String(req.query.videoId) : null;
    const labellerId = req.query.labellerId ? String(req.query.labellerId) : null;
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const cursor = req.query.cursor ? String(req.query.cursor) : null;
    const includeTotal = String(req.query.includeTotal || "") === "1";

    const collection = getProjectImagesCollection(projectId);

    if (ids && ids.length > 0) {
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += 10) {
        chunks.push(ids.slice(i, i + 10));
      }

      const results = await Promise.all(
        chunks.map((chunk) => collection.where("imageId", "in", chunk).get())
      );

      const items = results.flatMap((snapshot) =>
        snapshot.docs.map((doc) => normalizeImageData(doc.data()))
      );

      return res.json({ items, cursor: null });
    }

    let query: FirebaseFirestore.Query = collection.orderBy("createdAt", "desc");

    if (status) {
      query = query.where("meta.status", "==", status);
    }
    if (videoId) {
      query = query.where("videoId", "==", videoId);
    }
    if (labellerId) {
      query = query.where("labellerId", "==", labellerId);
    }

    if (cursor) {
      const cursorDoc = await collection.doc(cursor).get();
      if (cursorDoc.exists) {
        query = query.startAfter(cursorDoc);
      }
    }

    const snapshot = await query.limit(limit).get();
    const items = snapshot.docs.map((doc) => normalizeImageData(doc.data()));
    const nextCursor = snapshot.docs.length
      ? snapshot.docs[snapshot.docs.length - 1].id
      : null;

    let total: number | undefined;
    if (includeTotal) {
      const countSnapshot = await query.count().get();
      total = countSnapshot.data().count;
    }

    res.json({ items, cursor: nextCursor, total });
  })
);

router.get(
  "/:projectId/images/available",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      throw new HttpError(401, "UNAUTHORIZED", "Missing auth context");
    }

    const projectId = req.params.projectId;
    await ensureProjectAccess(projectId, user.uid);

    const limit = Math.min(Number(req.query.limit) || 5, 50);
    const status = req.query.status ? String(req.query.status) : null;
    const includeFileUrl = String(req.query.includeFileUrl || "") === "1";

    const now = Date.now();
    const locksSnapshot = await getProjectLocksCollection(projectId).get();
    const lockedIds = new Set(
      locksSnapshot.docs
        .map((doc) => doc.data())
        .filter((lock) => {
          const expiresAt = lock.expiresAt as FirebaseFirestore.Timestamp | undefined;
          return expiresAt ? expiresAt.toMillis() > now : false;
        })
        .map((lock) => lock.imageId as string)
    );

    let query: FirebaseFirestore.Query = getProjectImagesCollection(projectId)
    
    if (status) {
      query = query.where("meta.status", "==", status);
    }

    const batchLimit = Math.min(limit * 5, 100);
    const snapshot = await query.limit(batchLimit).get();

    const available = snapshot.docs
      .map((doc) => normalizeImageData(doc.data()))
      .filter((image) => !lockedIds.has(image.imageId))
      .slice(0, limit);

    const items = includeFileUrl
      ? await Promise.all(
          available.map(async (image) => {
            if (!image.storagePath) {
              return image;
            }
            const fileUrl = await getSignedReadUrl(image.storagePath);
            return { ...image, fileUrl };
          })
        )
      : available;

    res.json({ items });
  })
);

router.get(
  "/:projectId/images/:imageId",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      throw new HttpError(401, "UNAUTHORIZED", "Missing auth context");
    }

    const { projectId, imageId } = req.params;
    await ensureProjectAccess(projectId, user.uid);

    const doc = await getProjectImagesCollection(projectId).doc(imageId).get();
    if (!doc.exists) {
      throw new HttpError(404, "NOT_FOUND", "Image not found");
    }

    res.json(normalizeImageData(doc.data() || {}));
  })
);

router.get(
  "/:projectId/images/:imageId/file",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      throw new HttpError(401, "UNAUTHORIZED", "Missing auth context");
    }

    const { projectId, imageId } = req.params;
    await ensureProjectAccess(projectId, user.uid);

    const doc = await getProjectImagesCollection(projectId).doc(imageId).get();
    if (!doc.exists) {
      throw new HttpError(404, "NOT_FOUND", "Image not found");
    }
    const data = doc.data();
    if (!data?.storagePath) {
      throw new HttpError(404, "NOT_FOUND", "Image file not found");
    }

    const metadata = await getFileMetadata(data.storagePath);
    if (metadata.contentType) {
      res.setHeader("Content-Type", metadata.contentType);
    }

    const stream = await getFileStream(data.storagePath);
    stream.pipe(res);
  })
);

router.delete(
  "/:projectId/images/:imageId",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      throw new HttpError(401, "UNAUTHORIZED", "Missing auth context");
    }

    const { projectId, imageId } = req.params;
    await ensureProjectAccess(projectId, user.uid);

    const doc = await getProjectImagesCollection(projectId).doc(imageId).get();
    if (doc.exists) {
      const data = doc.data();
      if (data?.storagePath) {
        await deleteFileIfExists(data.storagePath);
      }
      await doc.ref.delete();
    }

    res.json({ success: true, deletedId: imageId });
  })
);

router.post(
  "/:projectId/locks",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      throw new HttpError(401, "UNAUTHORIZED", "Missing auth context");
    }

    const projectId = req.params.projectId;
    await ensureProjectAccess(projectId, user.uid);

    const parsed = lockAcquireSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "VALIDATION_ERROR", parsed.error.message);
    }

    if (parsed.data.userId !== user.uid) {
      throw new HttpError(403, "FORBIDDEN", "userId mismatch");
    }

    const durationMs = parsed.data.durationMs ?? 30 * 60 * 1000;
    const now = Date.now();
    const expiresAt = Timestamp.fromMillis(now + durationMs);

    const results = await Promise.all(
      parsed.data.imageIds.map(async (imageId: string) => {
        const lockRef = getProjectLocksCollection(projectId).doc(imageId);
        return firestore.runTransaction(async (txn) => {
          const lockDoc = await txn.get(lockRef);
          if (!lockDoc.exists) {
            txn.set(lockRef, {
              imageId,
              lockedBy: user.uid,
              expiresAt,
              updatedAt: FieldValue.serverTimestamp(),
            });
            return {
              imageId,
              locked: true,
              lockedBy: user.uid,
              expiresAt: expiresAt.toDate().toISOString(),
            };
          }

          const data = lockDoc.data();
          const lockedBy = data?.lockedBy;
          const expiresValue = data?.expiresAt as FirebaseFirestore.Timestamp | undefined;
          const expiresMillis = expiresValue?.toMillis() ?? 0;

          if (lockedBy === user.uid || expiresMillis <= now) {
            txn.set(lockRef, {
              imageId,
              lockedBy: user.uid,
              expiresAt,
              updatedAt: FieldValue.serverTimestamp(),
            });
            return {
              imageId,
              locked: true,
              lockedBy: user.uid,
              expiresAt: expiresAt.toDate().toISOString(),
            };
          }

          return {
            imageId,
            locked: false,
            lockedBy: lockedBy ?? null,
            expiresAt: expiresValue ? expiresValue.toDate().toISOString() : null,
            error: "ALREADY_LOCKED",
          };
        });
      })
    );

    res.json({ results });
  })
);

router.delete(
  "/:projectId/locks",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      throw new HttpError(401, "UNAUTHORIZED", "Missing auth context");
    }

    const projectId = req.params.projectId;
    await ensureProjectAccess(projectId, user.uid);

    const parsed = lockReleaseSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "VALIDATION_ERROR", parsed.error.message);
    }

    if (parsed.data.userId !== user.uid) {
      throw new HttpError(403, "FORBIDDEN", "userId mismatch");
    }

    const results = await Promise.all(
      parsed.data.imageIds.map(async (imageId: string) => {
        const lockRef = getProjectLocksCollection(projectId).doc(imageId);
        return firestore.runTransaction(async (txn) => {
          const lockDoc = await txn.get(lockRef);
          if (!lockDoc.exists) {
            return { imageId, released: false };
          }

          const data = lockDoc.data();
          if (data?.lockedBy !== user.uid) {
            return { imageId, released: false };
          }

          txn.delete(lockRef);
          return { imageId, released: true };
        });
      })
    );

    res.json({ results });
  })
);

export default router;
