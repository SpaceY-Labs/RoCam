import { describe, it, expect } from "vitest";
import {
  colorSchema,
  isoDateSchema,
  labelSchema,
  labelsMapSchema,
  maskSchema,
  maskLabelsMapSchema,
  maskMapSchema,
  projectCreateSchema,
  projectUpdateSchema,
  imageStatusSchema,
  imageMetaSchema,
  lockAcquireSchema,
  lockReleaseSchema,
  maskCreateSchema,
  maskUpdateSchema,
  maskBatchUpdateSchema,
  zipUploadMetaSchema,
} from "../validation/schemas";

// ============================================================================
// colorSchema
// ============================================================================
describe("colorSchema", () => {
  it("accepts 6-digit hex colors", () => {
    expect(colorSchema.safeParse("#FF0000").success).toBe(true);
    expect(colorSchema.safeParse("#aabbcc").success).toBe(true);
  });

  it("accepts 3-digit hex colors", () => {
    expect(colorSchema.safeParse("#F00").success).toBe(true);
    expect(colorSchema.safeParse("#abc").success).toBe(true);
  });

  it("rejects invalid colors", () => {
    expect(colorSchema.safeParse("red").success).toBe(false);
    expect(colorSchema.safeParse("#GGGGGG").success).toBe(false);
    expect(colorSchema.safeParse("#12345").success).toBe(false);
    expect(colorSchema.safeParse("").success).toBe(false);
  });
});

// ============================================================================
// isoDateSchema
// ============================================================================
describe("isoDateSchema", () => {
  it("accepts valid ISO 8601 datetime strings", () => {
    expect(isoDateSchema.safeParse("2024-01-15T10:30:00.000Z").success).toBe(true);
  });

  it("rejects non-ISO date strings", () => {
    expect(isoDateSchema.safeParse("2024-01-15").success).toBe(false);
    expect(isoDateSchema.safeParse("not-a-date").success).toBe(false);
  });
});

// ============================================================================
// labelSchema
// ============================================================================
describe("labelSchema", () => {
  const valid = { labelId: "lbl-1", name: "Car", color: "#FF0000" };

  it("accepts a valid label", () => {
    expect(labelSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects empty labelId", () => {
    expect(labelSchema.safeParse({ ...valid, labelId: "" }).success).toBe(false);
  });

  it("rejects empty name", () => {
    expect(labelSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
  });

  it("rejects invalid color", () => {
    expect(labelSchema.safeParse({ ...valid, color: "blue" }).success).toBe(false);
  });
});

// ============================================================================
// labelsMapSchema
// ============================================================================
describe("labelsMapSchema", () => {
  it("accepts a valid labels map", () => {
    const data = {
      "lbl-1": { labelId: "lbl-1", name: "Car", color: "#FF0000" },
    };
    expect(labelsMapSchema.safeParse(data).success).toBe(true);
  });

  it("rejects map with invalid label entry", () => {
    const data = { "lbl-1": { labelId: "", name: "Car", color: "#FF0000" } };
    expect(labelsMapSchema.safeParse(data).success).toBe(false);
  });
});

// ============================================================================
// maskSchema
// ============================================================================
describe("maskSchema", () => {
  const valid = {
    maskId: "mask-1",
    labelId: "lbl-1",
    color: "#00FF00",
    storagePath: "projects/p/images/i/masks/m.bin",
    size: 100,
    width: 640,
    height: 480,
  };

  it("accepts a valid mask", () => {
    expect(maskSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts null labelId and color", () => {
    expect(maskSchema.safeParse({ ...valid, labelId: null, color: null }).success).toBe(true);
  });

  it("rejects negative size", () => {
    expect(maskSchema.safeParse({ ...valid, size: -1 }).success).toBe(false);
  });

  it("rejects non-positive width", () => {
    expect(maskSchema.safeParse({ ...valid, width: 0 }).success).toBe(false);
  });
});

// ============================================================================
// maskLabelsMapSchema
// ============================================================================
describe("maskLabelsMapSchema", () => {
  it("accepts a map with string and null label IDs", () => {
    const data = { "mask-1": "lbl-1", "mask-2": null };
    expect(maskLabelsMapSchema.safeParse(data).success).toBe(true);
  });
});

// ============================================================================
// maskMapSchema
// ============================================================================
describe("maskMapSchema", () => {
  const valid = {
    maskMapId: "mm-1",
    imageId: "img-1",
    maskLabels: { "mask-1": "lbl-1", "mask-2": null },
    colorMapStoragePath: "projects/p/maskmaps/mm-1/colormap.json",
    maskIds: ["mask-1", "mask-2"],
    width: 640,
    height: 480,
  };

  it("accepts a valid mask map", () => {
    expect(maskMapSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects empty maskMapId", () => {
    expect(maskMapSchema.safeParse({ ...valid, maskMapId: "" }).success).toBe(false);
  });
});

// ============================================================================
// projectCreateSchema
// ============================================================================
describe("projectCreateSchema", () => {
  const validLabels = {
    "lbl-1": { labelId: "lbl-1", name: "Car", color: "#FF0000" },
  };

  it("accepts a valid project creation payload", () => {
    const data = { name: "My Project", labels: validLabels };
    expect(projectCreateSchema.safeParse(data).success).toBe(true);
  });

  it("accepts an optional description", () => {
    const data = { name: "My Project", description: "A description", labels: validLabels };
    expect(projectCreateSchema.safeParse(data).success).toBe(true);
  });

  it("rejects empty labels map", () => {
    const data = { name: "My Project", labels: {} };
    expect(projectCreateSchema.safeParse(data).success).toBe(false);
  });

  it("rejects empty project name", () => {
    const data = { name: "", labels: validLabels };
    expect(projectCreateSchema.safeParse(data).success).toBe(false);
  });
});

// ============================================================================
// projectUpdateSchema
// ============================================================================
describe("projectUpdateSchema", () => {
  it("accepts updating name only", () => {
    expect(projectUpdateSchema.safeParse({ name: "New Name" }).success).toBe(true);
  });

  it("rejects empty update object", () => {
    expect(projectUpdateSchema.safeParse({}).success).toBe(false);
  });
});

// ============================================================================
// imageStatusSchema
// ============================================================================
describe("imageStatusSchema", () => {
  it("accepts valid statuses", () => {
    for (const s of ["unlabeled", "in_progress", "labeled"]) {
      expect(imageStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects invalid status", () => {
    expect(imageStatusSchema.safeParse("done").success).toBe(false);
  });
});

// ============================================================================
// imageMetaSchema
// ============================================================================
describe("imageMetaSchema", () => {
  const valid = { fileName: "photo.jpg", width: 1920, height: 1080, status: "unlabeled" };

  it("accepts a valid image meta object", () => {
    expect(imageMetaSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts optional tags", () => {
    expect(imageMetaSchema.safeParse({ ...valid, tags: ["outdoor"] }).success).toBe(true);
  });

  it("rejects non-positive width", () => {
    expect(imageMetaSchema.safeParse({ ...valid, width: -1 }).success).toBe(false);
  });
});

// ============================================================================
// lockAcquireSchema
// ============================================================================
describe("lockAcquireSchema", () => {
  const valid = { imageIds: ["img-1"], userId: "user-1" };

  it("accepts a valid lock acquire request", () => {
    expect(lockAcquireSchema.safeParse(valid).success).toBe(true);
  });

  it("uses default durationMs of 15000", () => {
    const result = lockAcquireSchema.safeParse(valid);
    expect(result.success && result.data.durationMs).toBe(15000);
  });

  it("accepts custom durationMs", () => {
    const result = lockAcquireSchema.safeParse({ ...valid, durationMs: 30000 });
    expect(result.success && result.data.durationMs).toBe(30000);
  });

  it("rejects empty imageIds array", () => {
    expect(lockAcquireSchema.safeParse({ ...valid, imageIds: [] }).success).toBe(false);
  });

  it("rejects empty userId", () => {
    expect(lockAcquireSchema.safeParse({ ...valid, userId: "" }).success).toBe(false);
  });
});

// ============================================================================
// lockReleaseSchema
// ============================================================================
describe("lockReleaseSchema", () => {
  it("accepts a valid lock release request", () => {
    const data = { imageIds: ["img-1", "img-2"], userId: "user-1" };
    expect(lockReleaseSchema.safeParse(data).success).toBe(true);
  });

  it("rejects empty imageIds", () => {
    expect(lockReleaseSchema.safeParse({ imageIds: [], userId: "u" }).success).toBe(false);
  });
});

// ============================================================================
// maskCreateSchema
// ============================================================================
describe("maskCreateSchema", () => {
  const valid = {
    imageId: "img-1",
    binaryMask: { "0": { "0": 1 } },
    width: 640,
    height: 480,
  };

  it("accepts a valid mask create request", () => {
    expect(maskCreateSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts optional labelId", () => {
    expect(maskCreateSchema.safeParse({ ...valid, labelId: "lbl-1" }).success).toBe(true);
  });

  it("rejects non-positive height", () => {
    expect(maskCreateSchema.safeParse({ ...valid, height: 0 }).success).toBe(false);
  });
});

// ============================================================================
// maskUpdateSchema
// ============================================================================
describe("maskUpdateSchema", () => {
  it("accepts string labelId", () => {
    expect(maskUpdateSchema.safeParse({ labelId: "lbl-1" }).success).toBe(true);
  });

  it("accepts null labelId (unlabel)", () => {
    expect(maskUpdateSchema.safeParse({ labelId: null }).success).toBe(true);
  });

  it("rejects missing labelId field", () => {
    expect(maskUpdateSchema.safeParse({}).success).toBe(false);
  });
});

// ============================================================================
// maskBatchUpdateSchema
// ============================================================================
describe("maskBatchUpdateSchema", () => {
  const valid = {
    updates: [
      { maskId: "mask-1", labelId: "lbl-1" },
      { maskId: "mask-2", labelId: null },
    ],
  };

  it("accepts a valid batch update", () => {
    expect(maskBatchUpdateSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects empty updates array", () => {
    expect(maskBatchUpdateSchema.safeParse({ updates: [] }).success).toBe(false);
  });
});

// ============================================================================
// zipUploadMetaSchema
// ============================================================================
describe("zipUploadMetaSchema", () => {
  it("accepts an empty object using defaults", () => {
    const result = zipUploadMetaSchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.success && result.data.status).toBe("unlabeled");
  });

  it("accepts custom status and tags", () => {
    const data = { status: "labeled", tags: ["a", "b"] };
    expect(zipUploadMetaSchema.safeParse(data).success).toBe(true);
  });

  it("rejects invalid status", () => {
    expect(zipUploadMetaSchema.safeParse({ status: "unknown" }).success).toBe(false);
  });
});
