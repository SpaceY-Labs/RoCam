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

const toMaskRows = (mask: unknown): { values: number[] }[] => {
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
