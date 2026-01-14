import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { HttpError } from "../middleware/error";
import type { AuthenticatedRequest } from "../middleware/auth";
import type { SegmentLegacyRequest, SegmentSam3Request } from "shared";
import { segmentRequestSchema } from "shared";
import { ensureProjectAccess, getProjectImagesCollection } from "../services/projects";
import { getSignedReadUrl } from "../services/storage";
import { callSam3 } from "../services/sam3";

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

  return getSignedReadUrl(data.storagePath);
};

const isSam3Request = (
  payload: SegmentLegacyRequest | SegmentSam3Request
): payload is SegmentSam3Request => "type" in payload;

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

    const payload = parsed.data;

    if (isSam3Request(payload)) {
      const { projectId, imageId, ...sam3Request } = payload;
      if (projectId && imageId) {
        await ensureProjectAccess(projectId, user.uid);
      }

      if (payload.type === "start_session") {
        const hasResource =
          "resource_url" in sam3Request ||
          "resourceUrl" in sam3Request ||
          "resource_path" in sam3Request ||
          "resourcePath" in sam3Request;

        if (!hasResource) {
          if (!projectId || !imageId) {
            throw new HttpError(
              400,
              "VALIDATION_ERROR",
              "resourceUrl/resourcePath or projectId + imageId is required"
            );
          }
          sam3Request.resource_url = await resolveStoredImageUrl(
            projectId,
            imageId
          );
        }
      }

      const sam3Response = await callSam3(sam3Request);
      return res.json(sam3Response);
    }

    const {
      projectId,
      imageId,
      imageUrl,
      image,
      imageBase64,
      mode,
      points,
      box,
      prompt,
    } = payload;
    if (projectId && imageId) {
      await ensureProjectAccess(projectId, user.uid);
    }

    const resolvedImageBase64 = imageBase64 || image;
    let resolvedImageUrl = imageUrl;
    if (!resolvedImageUrl && !resolvedImageBase64) {
      if (!projectId || !imageId) {
        throw new HttpError(
          400,
          "VALIDATION_ERROR",
          "projectId + imageId or image/imageUrl/imageBase64 is required"
        );
      }
      resolvedImageUrl = await resolveStoredImageUrl(projectId, imageId);
    }

    const sam3Response = await callSam3({
      imageUrl: resolvedImageUrl,
      image: resolvedImageBase64,
      mode,
      points,
      box,
      prompt,
    });

    return res.json(sam3Response);
  })
);

export default router;
