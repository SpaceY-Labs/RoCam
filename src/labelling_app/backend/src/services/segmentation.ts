import { FieldValue } from "../firebase";
import { HttpError } from "../middleware/error";
import type { ProjectClass } from "shared";
import { buildMasksFromSam, serializeMasksForStorage } from "./masks";
import { ensureProjectAccess, getProjectImagesCollection } from "./projects";

const normalizePrompt = (prompt?: string) =>
  prompt ? prompt.trim().toLowerCase() : "";

const resolveClassForPrompt = (classes: ProjectClass[], prompt?: string) => {
  if (classes.length === 0) {
    return null;
  }

  const normalizedPrompt = normalizePrompt(prompt);
  if (normalizedPrompt) {
    const match =
      classes.find((cls) => cls.id.toLowerCase() === normalizedPrompt) ||
      classes.find((cls) => cls.name.toLowerCase() === normalizedPrompt);
    if (match) {
      return match;
    }
  }

  return classes[0];
};

export const saveSamMasksForImage = async (params: {
  projectId: string;
  imageId: string;
  userId: string;
  samResponse: unknown;
  mode: "auto";
  prompt?: string;
  skipIfMasksPresent?: boolean;
}) => {
  const { projectId, imageId, userId, samResponse, mode, prompt, skipIfMasksPresent } = params;

  const projectDoc = await ensureProjectAccess(projectId, userId);
  const projectData = projectDoc.data();
  const classes = (projectData?.classes || []) as ProjectClass[];
  const labelClass = resolveClassForPrompt(classes, prompt);
  if (!labelClass) {
    throw new HttpError(400, "VALIDATION_ERROR", "Project has no classes");
  }

  const imageRef = getProjectImagesCollection(projectId).doc(imageId);
  const imageDoc = await imageRef.get();
  if (!imageDoc.exists) {
    throw new HttpError(404, "NOT_FOUND", "Image not found");
  }

  if (skipIfMasksPresent && Array.isArray(imageDoc.data()?.masks) && imageDoc.data()?.masks.length > 0) {
    return { imageId, masksCount: imageDoc.data()?.masks.length || 0, skipped: true };
  }

  const masks = buildMasksFromSam(samResponse, labelClass, "sam2_auto");
  const storedMasks = serializeMasksForStorage(masks);

  await imageRef.set(
    {
      masks: storedMasks,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { imageId, masksCount: storedMasks.length, skipped: false };
};
