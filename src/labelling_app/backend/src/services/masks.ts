import { v4 as uuidv4 } from "uuid";
import type { ProjectClass } from "shared";

type MaskRow = { values: number[] };

const normalizeMaskValue = (value: unknown) => {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return numeric === 0 ? 0 : 1;
};

const isMaskRowObject = (value: unknown): value is { values: unknown } =>
  Boolean(value && typeof value === "object" && "values" in (value as Record<string, unknown>));

const normalizeMaskRow = (row: unknown) =>
  Array.isArray(row) ? row.map(normalizeMaskValue) : [];

const toMaskMatrix = (mask: unknown): number[][] => {
  if (!Array.isArray(mask)) {
    return [];
  }

  if (mask.every((row) => Array.isArray(row))) {
    return mask.map((row) => normalizeMaskRow(row));
  }

  if (mask.every((row) => isMaskRowObject(row))) {
    return mask.map((row) => normalizeMaskRow((row as { values?: unknown }).values));
  }

  return [];
};

const toMaskRows = (mask: unknown): MaskRow[] => {
  if (!Array.isArray(mask)) {
    return [];
  }

  if (mask.every((row) => Array.isArray(row))) {
    return mask.map((row) => ({ values: normalizeMaskRow(row) }));
  }

  if (mask.every((row) => isMaskRowObject(row))) {
    return mask.map((row) => ({
      values: normalizeMaskRow((row as { values?: unknown }).values),
    }));
  }

  return [];
};

export const normalizeMasksForResponse = (masks: unknown) => {
  if (!Array.isArray(masks)) {
    return [];
  }

  return masks.flatMap((mask) => {
    if (!mask || typeof mask !== "object") {
      return [];
    }
    const typedMask = mask as Record<string, unknown>;
    const rest = { ...typedMask };
    const rawMask = rest.mask;
    delete rest.mask;
    delete (rest as { polygon?: unknown }).polygon;
    delete (rest as { rle?: unknown }).rle;
    const maskMatrix = toMaskMatrix(rawMask);
    return [
      {
        ...rest,
        ...(maskMatrix.length > 0 ? { mask: maskMatrix } : {}),
      },
    ];
  });
};

export const serializeMasksForStorage = (masks: unknown) => {
  if (!Array.isArray(masks)) {
    return [];
  }

  return masks.flatMap((mask) => {
    if (!mask || typeof mask !== "object") {
      return [];
    }
    const typedMask = mask as Record<string, unknown>;
    const rest = { ...typedMask };
    const rawMask = rest.mask;
    delete rest.mask;
    delete (rest as { polygon?: unknown }).polygon;
    delete (rest as { rle?: unknown }).rle;
    const maskRows = toMaskRows(rawMask);
    return [
      {
        ...rest,
        ...(maskRows.length > 0 ? { mask: maskRows } : {}),
      },
    ];
  });
};

export const extractSamMasks = (samResponse: unknown) => {
  if (!samResponse || typeof samResponse !== "object") {
    return [];
  }

  const response = samResponse as Record<string, unknown>;
  if (Array.isArray(response.masks)) {
    return response.masks.filter((mask) => mask && typeof mask === "object");
  }

  const outputs = response.outputs;
  if (outputs && typeof outputs === "object") {
    const typedOutputs = outputs as Record<string, unknown>;
    if (Array.isArray(typedOutputs.masks)) {
      return typedOutputs.masks.filter((mask) => mask && typeof mask === "object");
    }
  }

  return [];
};

export const buildMasksFromSam = (
  samResponse: unknown,
  labelClass: ProjectClass,
  source: "sam2_click" | "sam2_auto" | "sam2_semantic"
) => {
  const rawMasks = extractSamMasks(samResponse);
  if (rawMasks.length === 0) {
    return [];
  }

  return rawMasks.flatMap((mask, index) => {
    const typedMask = mask as Record<string, unknown>;
    const boundingBox =
      typedMask.boundingBox && typeof typedMask.boundingBox === "object"
        ? typedMask.boundingBox
        : undefined;
    const maskPayload = typedMask.mask;
    if (!maskPayload && !boundingBox) {
      return [];
    }
    return [
      {
        id: `mask_${Date.now()}_${index}_${uuidv4()}`,
        classId: labelClass.id,
        className: labelClass.name,
        color: labelClass.color,
        ...(maskPayload ? { mask: maskPayload } : {}),
        ...(boundingBox ? { boundingBox } : {}),
        source,
      },
    ];
  });
};
