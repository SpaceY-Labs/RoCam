import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { HttpError } from "../middleware/error";
import type { AuthenticatedRequest } from "../middleware/auth";
import type { SegmentLegacyRequest } from "shared";
import { segmentRequestSchema } from "shared";
import { ensureProjectAccess, getProjectImagesCollection } from "../services/projects";
import { getSignedReadUrl } from "../services/storage";
import { callSam } from "../services/sam";
import { saveSamMasksForImage } from "../services/segmentation";

const router = Router();

const resolveStoredImageUrl = async (projectId: string, imageId: string) => {
  const imageDoc = await getProjectImagesCollection(projectId).doc(imageId).get();
  if (!imageDoc.exists) {
    throw new HttpError(404, "NOT_FOUND", "Image not found");
  }

  const data = imageDoc.data();
  if (!data?.storagePath) {
    throw new HttpError(404, "NOT_FOUND", "Image file not found");
  }

  return {
    url: await getSignedReadUrl(data.storagePath),
    data,
  };
};

router.post(
  "/",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      throw new HttpError(401, "UNAUTHORIZED", "Missing auth context");
    }

    const parsed = segmentRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "VALIDATION_ERROR", parsed.error.message);
    }

    const payload = parsed.data as SegmentLegacyRequest;

    const { projectId, imageId, prompt } = payload;
    if (!projectId || !imageId) {
      throw new HttpError(
        400,
        "VALIDATION_ERROR",
        "projectId and imageId are required for segmentation"
      );
    }

    await ensureProjectAccess(projectId, user.uid);

    const resolved = await resolveStoredImageUrl(projectId, imageId);
    const imageData = resolved.data || null;

    if (imageData && Array.isArray(imageData.masks) && imageData.masks.length > 0) {
      return res.json({
        imageId,
        masksCount: imageData.masks.length,
        saved: true,
        skipped: true,
      });
    }

    const samResponse = await callSam({
      imageUrl: resolved.url,
      mode: "auto",
      ...(prompt ? { prompt } : {}),
    });

    const saved = await saveSamMasksForImage({
      projectId,
      imageId,
      userId: user.uid,
      samResponse,
      mode: "auto",
      prompt,
    });
    return res.json({
      imageId,
      masksCount: saved.masksCount,
      saved: true,
      skipped: saved.skipped || false,
    });
  })
);

export default router;
