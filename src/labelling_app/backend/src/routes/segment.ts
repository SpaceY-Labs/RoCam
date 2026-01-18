import crypto from "node:crypto";
import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { HttpError } from "../middleware/error";
import type { AuthenticatedRequest } from "../middleware/auth";
import type { SegmentLegacyRequest, SegmentSam3Request } from "shared";
import { segmentRequestSchema } from "shared";
import { ensureProjectAccess, getProjectImagesCollection } from "../services/projects";
import { getSignedReadUrl } from "../services/storage";
import { callSam } from "../services/sam";

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

const samSessions = new Map<string, { resourceUrl: string }>();

type LegacyPoint = NonNullable<SegmentLegacyRequest["points"]>[number];

const getSam3ResourceUrl = (payload: Record<string, unknown>) => {
  const resourceUrl = payload.resource_url ?? payload.resourceUrl;
  return typeof resourceUrl === "string" ? resourceUrl : undefined;
};

const getSam3SessionId = (payload: Record<string, unknown>) => {
  const sessionId = payload.session_id ?? payload.sessionId ?? payload.session;
  return sessionId ? String(sessionId) : undefined;
};

const parseSam3Points = (payload: Record<string, unknown>): LegacyPoint[] => {
  const rawPoints = payload.points;
  const rawLabels = payload.point_labels ?? payload.pointLabels;
  if (!Array.isArray(rawPoints)) {
    return [];
  }
  const labels = Array.isArray(rawLabels) ? rawLabels : [];

  return rawPoints.flatMap((point, index) => {
    let coords: [unknown, unknown] | null = null;
    if (Array.isArray(point) && point.length >= 2) {
      coords = [point[0], point[1]];
    } else if (point && typeof point === "object" && "x" in point && "y" in point) {
      const typedPoint = point as { x?: unknown; y?: unknown };
      coords = [typedPoint.x, typedPoint.y];
    }

    if (!coords) {
      return [];
    }

    const xValue = Number(coords[0]);
    const yValue = Number(coords[1]);
    if (!Number.isFinite(xValue) || !Number.isFinite(yValue)) {
      return [];
    }

    const rawLabel = labels[index];
    const label = rawLabel === 0 || rawLabel === "0" ? 0 : 1;
    return [{ x: xValue, y: yValue, label }];
  });
};

const parseSam3Box = (
  payload: Record<string, unknown>
): SegmentLegacyRequest["box"] | undefined => {
  const rawBox = payload.box ?? payload.bbox ?? payload.bounding_box;
  if (Array.isArray(rawBox) && rawBox.length >= 4) {
    const [x1, y1, x2, y2] = rawBox;
    if ([x1, y1, x2, y2].every((value) => Number.isFinite(Number(value)))) {
      return {
        x1: Number(x1),
        y1: Number(y1),
        x2: Number(x2),
        y2: Number(y2),
      };
    }
  }

  if (rawBox && typeof rawBox === "object") {
    const typedBox = rawBox as {
      x1?: unknown;
      y1?: unknown;
      x2?: unknown;
      y2?: unknown;
    };
    if (
      [typedBox.x1, typedBox.y1, typedBox.x2, typedBox.y2].every((value) =>
        Number.isFinite(Number(value))
      )
    ) {
      return {
        x1: Number(typedBox.x1),
        y1: Number(typedBox.y1),
        x2: Number(typedBox.x2),
        y2: Number(typedBox.y2),
      };
    }
  }

  return undefined;
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

      const requestType = String(payload.type || "");
      const sessionId = getSam3SessionId(sam3Request);

      if (requestType === "start_session") {
        let resourceUrl = getSam3ResourceUrl(sam3Request);
        if (!resourceUrl) {
          if (!projectId || !imageId) {
            throw new HttpError(
              400,
              "VALIDATION_ERROR",
              "resourceUrl or projectId + imageId is required"
            );
          }
          resourceUrl = await resolveStoredImageUrl(projectId, imageId);
        }

        const newSessionId = crypto.randomUUID();
        samSessions.set(newSessionId, { resourceUrl });
        return res.json({ session_id: newSessionId });
      }

      if (requestType === "close_session") {
        if (sessionId) {
          samSessions.delete(sessionId);
        }
        return res.json({ closed: true });
      }

      if (requestType === "add_prompt") {
        let resourceUrl = getSam3ResourceUrl(sam3Request);
        if (!resourceUrl && sessionId) {
          resourceUrl = samSessions.get(sessionId)?.resourceUrl;
        }
        if (!resourceUrl && projectId && imageId) {
          resourceUrl = await resolveStoredImageUrl(projectId, imageId);
        }
        if (!resourceUrl) {
          throw new HttpError(
            400,
            "VALIDATION_ERROR",
            "resourceUrl or active session is required"
          );
        }

        const points = parseSam3Points(sam3Request);
        const box = parseSam3Box(sam3Request);
        const rawText = sam3Request.text;
        const prompt = typeof rawText === "string" ? rawText.trim() : undefined;

        const mode = points.length > 0 || box ? "click" : "auto";

        const samResponse = await callSam({
          imageUrl: resourceUrl,
          mode,
          points: points.length > 0 ? points : undefined,
          box,
          prompt: prompt || undefined,
        });
        return res.json(samResponse);
      }

      throw new HttpError(
        400,
        "VALIDATION_ERROR",
        `Unsupported SAM3 request type: ${requestType || "unknown"}`
      );
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

    const samResponse = await callSam({
      imageUrl: resolvedImageUrl,
      image: resolvedImageBase64,
      mode,
      points,
      box,
      prompt,
    });

    return res.json(samResponse);
  })
);

export default router;
