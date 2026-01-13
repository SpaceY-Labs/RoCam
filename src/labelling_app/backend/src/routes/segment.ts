import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { HttpError } from "../middleware/error";
import type { AuthenticatedRequest } from "../middleware/auth";
import { segmentRequestSchema } from "shared";
import { ensureProjectAccess, getProjectImagesCollection } from "../services/projects";
import { getSignedReadUrl } from "../services/storage";
import { callSam3 } from "../services/sam3";

const router = Router();

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

    const { projectId, imageId, mode, points, box, prompt } = parsed.data;
    await ensureProjectAccess(projectId, user.uid);

    const imageDoc = await getProjectImagesCollection(projectId).doc(imageId).get();
    if (!imageDoc.exists) {
      throw new HttpError(404, "NOT_FOUND", "Image not found");
    }

    const data = imageDoc.data();
    if (!data?.storagePath) {
      throw new HttpError(404, "NOT_FOUND", "Image file not found");
    }

    const imageUrl = await getSignedReadUrl(data.storagePath);

    const sam3Response = await callSam3({
      imageUrl,
      mode,
      points,
      box,
      prompt,
    });

    res.json(sam3Response);
  })
);

export default router;
