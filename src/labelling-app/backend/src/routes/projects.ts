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
  maskUpdateSchema,
  maskBatchUpdateSchema,
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
  getProjectMasksCollection,
  getProjectMaskMapsCollection,
} from "../services/projects";
import {
  parseFeatherMask,
  getBaseName,
  getMaskImageBaseName,
  type ParsedMask,
  type SparseBinaryMask,
  prepareMaskFromParsed,
  createMaskMapFromMasks,
  computeColorMap,
  rawBinaryToSparseMask,
  generateMaskOverlay,
} from "../services/masks";
import {
  uploadMaskBuffer,
  downloadMaskBuffer,
  buildMaskStoragePath,
  buildColorMapStoragePath,
  uploadColorMap,
  downloadColorMap,
  buildMaskOverlayStoragePath,
  uploadMaskOverlay,
  downloadMaskOverlay,
} from "../services/storage";

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
  data as FirebaseFirestore.DocumentData;

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

// ============================================================================
// PROJECT ROUTES
// ============================================================================

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
      labels: parsed.data.labels,
      imageIds: [],
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
        labels: data.labels ?? {},
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
      labels: data?.labels ?? {},
      imageIds: data?.imageIds ?? [],
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

    // Delete all masks
    const masksCollection = getProjectMasksCollection(projectId);
    const masksSnapshot = await masksCollection.get();
    await Promise.all(masksSnapshot.docs.map((maskDoc: FirebaseFirestore.QueryDocumentSnapshot) => maskDoc.ref.delete()));

    // Delete all mask maps
    const maskMapsCollection = getProjectMaskMapsCollection(projectId);
    const maskMapsSnapshot = await maskMapsCollection.get();
    await Promise.all(maskMapsSnapshot.docs.map((mapDoc: FirebaseFirestore.QueryDocumentSnapshot) => mapDoc.ref.delete()));

    // Delete all images and their storage files
    const imagesCollection = getProjectImagesCollection(projectId);
    const imagesSnapshot = await imagesCollection.get();
    for (const imageDoc of imagesSnapshot.docs) {
      const data = imageDoc.data();
      if (data?.storagePath) {
        await deleteFileIfExists(data.storagePath);
      }
      await imageDoc.ref.delete();
    }

    // Delete all locks
    const locksCollection = getProjectLocksCollection(projectId);
    const locksSnapshot = await locksCollection.get();
    await Promise.all(locksSnapshot.docs.map((lockDoc) => lockDoc.ref.delete()));

    await doc.ref.delete();

    res.json({ projectId, deleted: true });
  })
);

// ============================================================================
// ZIP UPLOAD ROUTE
// ============================================================================

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

    // Separate entries into images and masks based on folder structure
    // Expected structure: /image/*.png and /masks/*.feather (or .arrow)
    const imageEntries: Array<{ entryName: string; baseName: string; data: Buffer }> = [];
    const maskEntries: Array<{ entryName: string; baseName: string; data: Buffer }> = [];

    for (const entry of entries) {
      const entryPath = entry.entryName.toLowerCase();
      const fileName = path.basename(entry.entryName);
      const baseName = getBaseName(fileName);

      if (!fileName || !baseName) {
        continue;
      }

      const data = entry.getData();

      // Check if it's in the image folder
      if (entryPath.includes("/image/") || entryPath.startsWith("image/")) {
        imageEntries.push({ entryName: entry.entryName, baseName, data });
      }
      // Check if it's in the masks folder and is a feather/arrow file
      // Note: entryPath is lowercased, check for both forward and back slashes
      else if (
        (entryPath.includes("/masks/") || entryPath.includes("\\masks\\") ||
         entryPath.startsWith("masks/") || entryPath.startsWith("masks\\")) &&
        (entryPath.endsWith(".feather") || entryPath.endsWith(".arrow"))
      ) {
        console.log(`[ZIP Upload] Found mask entry: ${entry.entryName}`);
        // Use getMaskImageBaseName to strip the _XX suffix for matching with images
        // e.g., "image_00.feather" -> imageBaseName="image" to match "image.png"
        const imageBaseName = getMaskImageBaseName(fileName);
        maskEntries.push({ entryName: entry.entryName, baseName: imageBaseName, data });
      }
      // Fallback: if no folder structure, treat image files as images
      else if (
        entryPath.endsWith(".png") ||
        entryPath.endsWith(".jpg") ||
        entryPath.endsWith(".jpeg") ||
        entryPath.endsWith(".webp")
      ) {
        imageEntries.push({ entryName: entry.entryName, baseName, data });
      }
    }

    console.log(`[ZIP Upload] Found ${imageEntries.length} images and ${maskEntries.length} mask entries`);
    if (maskEntries.length > 0) {
      console.log(`[ZIP Upload] Mask entries:`, maskEntries.map(e => e.entryName));
    }

    if (imageEntries.length === 0) {
      throw new HttpError(400, "VALIDATION_ERROR", "No images found in zip. Expected images in /image/ folder.");
    }

    // Build a map of masks by image base name for quick lookup
    // Group masks by image base name (an image can have multiple masks)
    // maskEntry.baseName is already the image base name (e.g., "image" from "image_00.feather")
    const masksByBaseName = new Map<string, ParsedMask[]>();
    let maskIndex = 0;
    for (const maskEntry of maskEntries) {
      console.log(`[ZIP Upload] Parsing mask: ${maskEntry.entryName}, imageBaseName: ${maskEntry.baseName}, dataSize: ${maskEntry.data.length}`);
      const parsed = parseFeatherMask(maskEntry.data, maskEntry.baseName, maskIndex);
      if (parsed) {
        console.log(`[ZIP Upload] Mask parsed successfully for image: ${maskEntry.baseName}, maskIndex: ${maskIndex}`);
        const existing = masksByBaseName.get(maskEntry.baseName) || [];
        existing.push(parsed);
        masksByBaseName.set(maskEntry.baseName, existing);
        maskIndex++;
      } else {
        console.warn(`[ZIP Upload] Failed to parse mask: ${maskEntry.entryName}`);
      }
    }
    console.log(`[ZIP Upload] Total masks parsed: ${maskIndex}, for ${masksByBaseName.size} unique images`)

    // Prepare images with resizing
    const prepared: Array<{
      fileName: string;
      baseName: string;
      resized: { buffer: Buffer; contentType: string };
      parsedMasks: ParsedMask[] | null;
    }> = [];

    for (const imageEntry of imageEntries) {
      const fileName = path.basename(imageEntry.entryName);
      const resized = await resizeImageBuffer(imageEntry.data);
      const parsedMasks = masksByBaseName.get(imageEntry.baseName) || null;
      prepared.push({
        fileName,
        baseName: imageEntry.baseName,
        resized: { buffer: resized.buffer, contentType: resized.contentType },
        parsedMasks,
      });
    }

    const saved: Array<{ imageId: string; storagePath: string; maskMapId: string | null }> = [];
    const imageIds: string[] = [];

    try {
      for (const item of prepared) {
        const imageId = uuidv4();
        const storagePath = buildStoragePath(projectId, imageId, item.fileName);

        await uploadImageBuffer(storagePath, item.resized.buffer, item.resized.contentType);

        let maskMapId: string | null = null;
        const maskIds: string[] = [];

        // Create masks and mask map if we have parsed masks
        if (item.parsedMasks && item.parsedMasks.length > 0) {
          // Collect mask data for overlay generation
          const maskDataForOverlay: Array<{ maskId: string; size: number; binaryMask: SparseBinaryMask }> = [];
          const maskSizes: Record<string, number> = {};

          // Create individual mask documents and upload binary to storage
          for (const parsedMask of item.parsedMasks) {
            const maskId = uuidv4();
            const preparedMask = prepareMaskFromParsed(maskId, parsedMask);

            // Upload binary mask to Cloud Storage
            const maskStoragePath = buildMaskStoragePath(projectId, imageId, maskId);
            await uploadMaskBuffer(maskStoragePath, preparedMask.binary);

            // Save mask document to Firestore (with storagePath, not binaryMask)
            await getProjectMasksCollection(projectId).doc(maskId).set({
              ...preparedMask.doc,
              storagePath: maskStoragePath,
              createdAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            });

            maskIds.push(maskId);
            maskSizes[maskId] = preparedMask.doc.size;

            // Convert binary to sparse format for overlay generation
            const binaryMask = rawBinaryToSparseMask(
              preparedMask.binary,
              preparedMask.doc.width,
              preparedMask.doc.height
            );
            maskDataForOverlay.push({ maskId, size: preparedMask.doc.size, binaryMask });
          }

          // Create mask map with maskLabels dictionary
          maskMapId = uuidv4();

          // Upload empty colorMap to storage (initially no masks are labeled)
          const colorMapStoragePath = buildColorMapStoragePath(projectId, maskMapId);
          await uploadColorMap(colorMapStoragePath, {});

          // Generate and upload maskOverlay (2D array with smallest mask at each pixel)
          const maskOverlay = generateMaskOverlay(maskDataForOverlay, TARGET_WIDTH, TARGET_HEIGHT);
          const maskOverlayStoragePath = buildMaskOverlayStoragePath(projectId, maskMapId);
          await uploadMaskOverlay(maskOverlayStoragePath, maskOverlay);

          const maskMap = createMaskMapFromMasks(
            maskMapId,
            imageId,
            maskIds,
            maskSizes,
            colorMapStoragePath,
            maskOverlayStoragePath,
            TARGET_WIDTH,
            TARGET_HEIGHT
          );

          await getProjectMaskMapsCollection(projectId).doc(maskMapId).set({
            ...maskMap,
            maskIds,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }

        // Create image document
        await getProjectImagesCollection(projectId).doc(imageId).set(
          {
            imageId,
            projectId,
            maskMapId,
            labelComplete: false,
            reviewed: false,
            lock: null,
            videoId: null,
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

        saved.push({ imageId, storagePath, maskMapId });
        imageIds.push(imageId);
      }

      // Update project with new image IDs
      await firestore.collection("projects").doc(projectId).update({
        imageIds: FieldValue.arrayUnion(...imageIds),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      // Cleanup on error
      await Promise.allSettled(
        saved.map(async (item) => {
          await deleteFileIfExists(item.storagePath);
          await getProjectImagesCollection(projectId).doc(item.imageId).delete();
          if (item.maskMapId) {
            await getProjectMaskMapsCollection(projectId).doc(item.maskMapId).delete();
          }
        })
      );
      throw error;
    }

    const masksCount = prepared.filter(p => p.parsedMasks && p.parsedMasks.length > 0).length;
    res.status(201).json({
      imageIds: saved.map((item) => item.imageId),
      count: saved.length,
      masksCount,
    });
  })
);

// ============================================================================
// IMAGE ROUTES
// ============================================================================

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

    if (parsed.data.maskMapId !== undefined) {
      updates.maskMapId = parsed.data.maskMapId;
    }
    if (parsed.data.labelComplete !== undefined) {
      updates.labelComplete = parsed.data.labelComplete;
    }
    if (parsed.data.reviewed !== undefined) {
      updates.reviewed = parsed.data.reviewed;
    }
    if (parsed.data.videoId !== undefined) {
      updates.videoId = parsed.data.videoId;
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
    const includeFileUrl = String(req.query.includeFileUrl || "") === "1";

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

    const hydratedItems = includeFileUrl
      ? await Promise.all(
          items.map(async (image) => {
            if (!image?.storagePath) {
              return image;
            }
            try {
              const fileUrl = await getSignedReadUrl(image.storagePath);
              return { ...image, fileUrl };
            } catch {
              return image;
            }
          })
        )
      : items;

    res.json({ items: hydratedItems, cursor: nextCursor, total });
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

      // Delete associated mask map and masks
      if (data?.maskMapId) {
        const maskMapDoc = await getProjectMaskMapsCollection(projectId).doc(data.maskMapId).get();
        if (maskMapDoc.exists) {
          const maskMapData = maskMapDoc.data();
          // Delete all masks in this mask map
          if (maskMapData?.maskIds) {
            await Promise.all(
              maskMapData.maskIds.map((maskId: string) =>
                getProjectMasksCollection(projectId).doc(maskId).delete()
              )
            );
          }
          await maskMapDoc.ref.delete();
        }
      }

      // Delete storage file
      if (data?.storagePath) {
        await deleteFileIfExists(data.storagePath);
      }

      // Delete image document
      await doc.ref.delete();

      // Remove from project imageIds
      await firestore.collection("projects").doc(projectId).update({
        imageIds: FieldValue.arrayRemove(imageId),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    res.json({ success: true, deletedId: imageId });
  })
);

// ============================================================================
// MASK ROUTES
// ============================================================================

// Get all masks for an image
router.get(
  "/:projectId/images/:imageId/masks",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      throw new HttpError(401, "UNAUTHORIZED", "Missing auth context");
    }

    const { projectId, imageId } = req.params;
    await ensureProjectAccess(projectId, user.uid);

    // Get the image to find its maskMapId
    const imageDoc = await getProjectImagesCollection(projectId).doc(imageId).get();
    if (!imageDoc.exists) {
      throw new HttpError(404, "NOT_FOUND", "Image not found");
    }

    const imageData = imageDoc.data();
    if (!imageData?.maskMapId) {
      return res.json({ masks: [], maskMap: null });
    }

    // Get the mask map
    const maskMapDoc = await getProjectMaskMapsCollection(projectId).doc(imageData.maskMapId).get();
    if (!maskMapDoc.exists) {
      return res.json({ masks: [], maskMap: null });
    }

    const maskMapData = maskMapDoc.data();
    const maskIds = maskMapData?.maskIds || [];

    // Fetch all masks
    const masks = await Promise.all(
      maskIds.map(async (maskId: string) => {
        const maskDoc = await getProjectMasksCollection(projectId).doc(maskId).get();
        return maskDoc.exists ? maskDoc.data() : null;
      })
    );

    res.json({
      masks: masks.filter(Boolean),
      maskMap: maskMapData,
    });
  })
);

// Get mask overlay for an image (2D array of mask IDs for each pixel)
// This is used for hover detection on the frontend
router.get(
  "/:projectId/images/:imageId/maskoverlay",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      throw new HttpError(401, "UNAUTHORIZED", "Missing auth context");
    }

    const { projectId, imageId } = req.params;
    console.log(`[maskoverlay] GET /images/${imageId}/maskoverlay - Starting request`);

    await ensureProjectAccess(projectId, user.uid);
    console.log(`[maskoverlay] Project access verified for project: ${projectId}`);

    // Get the image to find its maskMapId
    const imageDoc = await getProjectImagesCollection(projectId).doc(imageId).get();
    if (!imageDoc.exists) {
      console.log(`[maskoverlay] Image not found: ${imageId}`);
      throw new HttpError(404, "NOT_FOUND", "Image not found");
    }
    console.log(`[maskoverlay] Image document found: ${imageId}`);

    const imageData = imageDoc.data();
    console.log(`[maskoverlay] Image maskMapId: ${imageData?.maskMapId || 'null'}`);

    if (!imageData?.maskMapId) {
      console.log(`[maskoverlay] No maskMapId for image ${imageId}, returning null`);
      res.json(null);
      return;
    }

    // Get the mask map to find the maskOverlay storage path
    console.log(`[maskoverlay] Fetching maskMap: ${imageData.maskMapId}`);
    const maskMapDoc = await getProjectMaskMapsCollection(projectId).doc(imageData.maskMapId).get();
    if (!maskMapDoc.exists) {
      console.log(`[maskoverlay] MaskMap not found: ${imageData.maskMapId}`);
      res.json(null);
      return;
    }
    console.log(`[maskoverlay] MaskMap document found: ${imageData.maskMapId}`);

    const maskMapData = maskMapDoc.data();
    const maskOverlayStoragePath = maskMapData?.maskOverlayStoragePath;
    console.log(`[maskoverlay] MaskOverlay storage path: ${maskOverlayStoragePath || 'null'}`);
    console.log(`[maskoverlay] MaskMap data keys: ${Object.keys(maskMapData || {}).join(', ')}`);

    if (!maskOverlayStoragePath) {
      console.log(`[maskoverlay] No maskOverlayStoragePath in maskMap, returning null`);
      res.json(null);
      return;
    }

    try {
      console.log(`[maskoverlay] Downloading maskOverlay from: ${maskOverlayStoragePath}`);
      const maskOverlay = await downloadMaskOverlay(maskOverlayStoragePath);
      console.log(`[maskoverlay] Downloaded maskOverlay - width: ${maskOverlay?.width}, height: ${maskOverlay?.height}, maskIds count: ${maskOverlay?.maskIds?.length}, data length: ${maskOverlay?.data?.length}`);
      res.json(maskOverlay);
    } catch (error) {
      console.error(`[maskoverlay] Error downloading maskOverlay from ${maskOverlayStoragePath}:`, error);
      res.json(null);
    }
  })
);

// Get a specific mask
router.get(
  "/:projectId/masks/:maskId",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      throw new HttpError(401, "UNAUTHORIZED", "Missing auth context");
    }

    const { projectId, maskId } = req.params;
    await ensureProjectAccess(projectId, user.uid);

    const maskDoc = await getProjectMasksCollection(projectId).doc(maskId).get();
    if (!maskDoc.exists) {
      throw new HttpError(404, "NOT_FOUND", "Mask not found");
    }

    res.json(maskDoc.data());
  })
);

// Update a mask's label
router.patch(
  "/:projectId/masks/:maskId",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      throw new HttpError(401, "UNAUTHORIZED", "Missing auth context");
    }

    const { projectId, maskId } = req.params;
    const projectDoc = await ensureProjectAccess(projectId, user.uid);
    const projectData = projectDoc.data();
    const labels = projectData?.labels || {};

    const parsed = maskUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "VALIDATION_ERROR", parsed.error.message);
    }

    const maskRef = getProjectMasksCollection(projectId).doc(maskId);
    const maskDoc = await maskRef.get();
    if (!maskDoc.exists) {
      throw new HttpError(404, "NOT_FOUND", "Mask not found");
    }

    const newLabelId = parsed.data.labelId;
    const newColor = newLabelId && labels[newLabelId] ? labels[newLabelId].color : null;

    // Update the mask
    await maskRef.update({
      labelId: newLabelId,
      color: newColor,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Find and update the associated mask map
    // We need to find which image this mask belongs to via the mask map
    const maskMapsSnapshot = await getProjectMaskMapsCollection(projectId)
      .where("maskIds", "array-contains", maskId)
      .get();

    if (!maskMapsSnapshot.empty) {
      const maskMapDoc = maskMapsSnapshot.docs[0];
      const maskMapData = maskMapDoc.data();

      // Update maskLabels dictionary (source of truth)
      const maskLabels = { ...(maskMapData?.maskLabels || {}) };
      maskLabels[maskId] = newLabelId;

      // Fetch all masks and their binary data from storage to recompute colorMap
      const allMaskIds = maskMapData?.maskIds || [];
      const width = maskMapData?.width || 0;
      const height = maskMapData?.height || 0;

      const allMasks = await Promise.all(
        allMaskIds.map(async (mid: string) => {
          const mDoc = await getProjectMasksCollection(projectId).doc(mid).get();
          if (!mDoc.exists) return null;

          const maskData = mDoc.data();
          const storagePath = maskData?.storagePath;
          if (!storagePath) return null;

          try {
            const binaryBuffer = await downloadMaskBuffer(storagePath);
            const binaryMask = rawBinaryToSparseMask(binaryBuffer, width, height);
            return { maskId: mid, binaryMask };
          } catch {
            console.warn(`Failed to download mask ${mid} from storage`);
            return null;
          }
        })
      );
      const validMasks = allMasks.filter((m): m is { maskId: string; binaryMask: Record<string, Record<string, 1>> } => m !== null);

      // Recompute colorMap with updated maskLabels
      const colorMap = computeColorMap(maskLabels, validMasks, labels);

      // Upload updated colorMap to storage
      const colorMapStoragePath = maskMapData?.colorMapStoragePath;
      if (colorMapStoragePath) {
        await uploadColorMap(colorMapStoragePath, colorMap);
      }

      await maskMapDoc.ref.update({
        maskLabels,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    res.json({ maskId, labelId: newLabelId, color: newColor });
  })
);

// Batch update masks
router.patch(
  "/:projectId/masks",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      throw new HttpError(401, "UNAUTHORIZED", "Missing auth context");
    }

    const projectId = req.params.projectId;
    const projectDoc = await ensureProjectAccess(projectId, user.uid);
    const projectData = projectDoc.data();
    const labels = projectData?.labels || {};

    const parsed = maskBatchUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "VALIDATION_ERROR", parsed.error.message);
    }

    const results = await Promise.all(
      parsed.data.updates.map(async (update) => {
        const maskRef = getProjectMasksCollection(projectId).doc(update.maskId);
        const maskDoc = await maskRef.get();

        if (!maskDoc.exists) {
          return { maskId: update.maskId, success: false, error: "NOT_FOUND" };
        }

        const newLabelId = update.labelId;
        const newColor = newLabelId && labels[newLabelId] ? labels[newLabelId].color : null;

        await maskRef.update({
          labelId: newLabelId,
          color: newColor,
          updatedAt: FieldValue.serverTimestamp(),
        });

        // Update associated mask map
        const maskMapsSnapshot = await getProjectMaskMapsCollection(projectId)
          .where("maskIds", "array-contains", update.maskId)
          .get();

        if (!maskMapsSnapshot.empty) {
          const maskMapDoc = maskMapsSnapshot.docs[0];
          const maskMapData = maskMapDoc.data();

          // Update maskLabels dictionary (source of truth)
          const maskLabels = { ...(maskMapData?.maskLabels || {}) };
          maskLabels[update.maskId] = newLabelId;

          // Fetch all masks and their binary data from storage to recompute colorMap
          const allMaskIds = maskMapData?.maskIds || [];
          const width = maskMapData?.width || 0;
          const height = maskMapData?.height || 0;

          const allMasks = await Promise.all(
            allMaskIds.map(async (mid: string) => {
              const mDoc = await getProjectMasksCollection(projectId).doc(mid).get();
              if (!mDoc.exists) return null;

              const mData = mDoc.data();
              const storagePath = mData?.storagePath;
              if (!storagePath) return null;

              try {
                const binaryBuffer = await downloadMaskBuffer(storagePath);
                const binaryMask = rawBinaryToSparseMask(binaryBuffer, width, height);
                return { maskId: mid, binaryMask };
              } catch {
                console.warn(`Failed to download mask ${mid} from storage`);
                return null;
              }
            })
          );
          const validMasks = allMasks.filter((m): m is { maskId: string; binaryMask: Record<string, Record<string, 1>> } => m !== null);

          // Recompute colorMap with updated maskLabels
          const colorMap = computeColorMap(maskLabels, validMasks, labels);

          // Upload updated colorMap to storage
          const colorMapStoragePath = maskMapData?.colorMapStoragePath;
          if (colorMapStoragePath) {
            await uploadColorMap(colorMapStoragePath, colorMap);
          }

          await maskMapDoc.ref.update({
            maskLabels,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }

        return { maskId: update.maskId, success: true, labelId: newLabelId, color: newColor };
      })
    );

    res.json({ results });
  })
);

// Delete a mask
router.delete(
  "/:projectId/masks/:maskId",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      throw new HttpError(401, "UNAUTHORIZED", "Missing auth context");
    }

    const { projectId, maskId } = req.params;
    await ensureProjectAccess(projectId, user.uid);

    const maskDocRef = getProjectMasksCollection(projectId).doc(maskId);
    const maskDocSnap = await maskDocRef.get();
    if (!maskDocSnap.exists) {
      throw new HttpError(404, "NOT_FOUND", "Mask not found");
    }

    const maskData = maskDocSnap.data();
    const maskStoragePath = maskData?.storagePath;

    // Get project labels for color recalculation
    const projectDoc = await firestore.collection("projects").doc(projectId).get();
    const projectData = projectDoc.data();
    const labels = projectData?.labels || {};

    // Remove from associated mask map
    const maskMapsSnapshot = await getProjectMaskMapsCollection(projectId)
      .where("maskIds", "array-contains", maskId)
      .get();

    if (!maskMapsSnapshot.empty) {
      const maskMapDoc = maskMapsSnapshot.docs[0];
      const maskMapData = maskMapDoc.data();

      // Remove from maskLabels dictionary
      const maskLabels = { ...(maskMapData?.maskLabels || {}) };
      delete maskLabels[maskId];

      // Get remaining mask IDs (excluding the one being deleted)
      const remainingMaskIds = (maskMapData?.maskIds || []).filter((mid: string) => mid !== maskId);
      const width = maskMapData?.width || 0;
      const height = maskMapData?.height || 0;

      // Fetch remaining masks from storage to recompute colorMap
      const remainingMasks = await Promise.all(
        remainingMaskIds.map(async (mid: string) => {
          const mDoc = await getProjectMasksCollection(projectId).doc(mid).get();
          if (!mDoc.exists) return null;

          const mData = mDoc.data();
          const storagePath = mData?.storagePath;
          if (!storagePath) return null;

          try {
            const binaryBuffer = await downloadMaskBuffer(storagePath);
            const binaryMask = rawBinaryToSparseMask(binaryBuffer, width, height);
            return { maskId: mid, binaryMask };
          } catch {
            console.warn(`Failed to download mask ${mid} from storage`);
            return null;
          }
        })
      );
      const validMasks = remainingMasks.filter((m): m is { maskId: string; binaryMask: Record<string, Record<string, 1>> } => m !== null);

      // Recompute colorMap without the deleted mask
      const colorMap = computeColorMap(maskLabels, validMasks, labels);

      // Upload updated colorMap to storage
      const colorMapStoragePath = maskMapData?.colorMapStoragePath;
      if (colorMapStoragePath) {
        await uploadColorMap(colorMapStoragePath, colorMap);
      }

      await maskMapDoc.ref.update({
        maskIds: FieldValue.arrayRemove(maskId),
        maskLabels,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    // Delete from Firestore
    await maskDocRef.delete();

    // Delete from storage
    if (maskStoragePath) {
      try {
        const { deleteFileIfExists } = await import("../services/storage");
        await deleteFileIfExists(maskStoragePath);
      } catch {
        console.warn(`Failed to delete mask file from storage: ${maskStoragePath}`);
      }
    }

    res.json({ success: true, deletedId: maskId });
  })
);

// ============================================================================
// MASK MAP ROUTES
// ============================================================================

// Get a mask map
router.get(
  "/:projectId/maskmaps/:maskMapId",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      throw new HttpError(401, "UNAUTHORIZED", "Missing auth context");
    }

    const { projectId, maskMapId } = req.params;
    await ensureProjectAccess(projectId, user.uid);

    const maskMapDoc = await getProjectMaskMapsCollection(projectId).doc(maskMapId).get();
    if (!maskMapDoc.exists) {
      throw new HttpError(404, "NOT_FOUND", "MaskMap not found");
    }

    res.json(maskMapDoc.data());
  })
);

// Get colorMap from storage for a mask map
router.get(
  "/:projectId/maskmaps/:maskMapId/colormap",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      throw new HttpError(401, "UNAUTHORIZED", "Missing auth context");
    }

    const { projectId, maskMapId } = req.params;
    await ensureProjectAccess(projectId, user.uid);

    const maskMapDoc = await getProjectMaskMapsCollection(projectId).doc(maskMapId).get();
    if (!maskMapDoc.exists) {
      throw new HttpError(404, "NOT_FOUND", "MaskMap not found");
    }

    const maskMapData = maskMapDoc.data();
    const colorMapStoragePath = maskMapData?.colorMapStoragePath;

    if (!colorMapStoragePath) {
      // Return empty colorMap if no path stored
      res.json({});
      return;
    }

    try {
      const colorMap = await downloadColorMap(colorMapStoragePath);
      res.json(colorMap);
    } catch {
      // Return empty colorMap if file doesn't exist
      res.json({});
    }
  })
);

// Get maskOverlay from storage
router.get(
  "/:projectId/maskmaps/:maskMapId/maskoverlay",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      throw new HttpError(401, "UNAUTHORIZED", "Missing auth context");
    }

    const { projectId, maskMapId } = req.params;
    console.log(`[maskoverlay] GET /maskmaps/${maskMapId}/maskoverlay - Starting request`);

    await ensureProjectAccess(projectId, user.uid);
    console.log(`[maskoverlay] Project access verified for project: ${projectId}`);

    const maskMapDoc = await getProjectMaskMapsCollection(projectId).doc(maskMapId).get();
    if (!maskMapDoc.exists) {
      console.log(`[maskoverlay] MaskMap not found: ${maskMapId}`);
      throw new HttpError(404, "NOT_FOUND", "MaskMap not found");
    }
    console.log(`[maskoverlay] MaskMap document found: ${maskMapId}`);

    const maskMapData = maskMapDoc.data();
    const maskOverlayStoragePath = maskMapData?.maskOverlayStoragePath;
    console.log(`[maskoverlay] MaskOverlay storage path: ${maskOverlayStoragePath || 'null'}`);
    console.log(`[maskoverlay] MaskMap data keys: ${Object.keys(maskMapData || {}).join(', ')}`);

    if (!maskOverlayStoragePath) {
      console.log(`[maskoverlay] No maskOverlayStoragePath in maskMap, returning null`);
      res.json(null);
      return;
    }

    try {
      console.log(`[maskoverlay] Downloading maskOverlay from: ${maskOverlayStoragePath}`);
      const maskOverlay = await downloadMaskOverlay(maskOverlayStoragePath);
      console.log(`[maskoverlay] Downloaded maskOverlay - width: ${maskOverlay?.width}, height: ${maskOverlay?.height}, maskIds count: ${maskOverlay?.maskIds?.length}, data length: ${maskOverlay?.data?.length}`);
      res.json(maskOverlay);
    } catch (error) {
      console.error(`[maskoverlay] Error downloading maskOverlay from ${maskOverlayStoragePath}:`, error);
      res.json(null);
    }
  })
);

// ============================================================================
// LOCK ROUTES
// ============================================================================

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

    // Default to 15 seconds as per design doc
    const durationMs = parsed.data.durationMs ?? 15000;
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
