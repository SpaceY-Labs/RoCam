import { z } from "zod";

const colorRegex = /^#(?:[0-9a-fA-F]{3}){1,2}$/;

export const colorSchema = z.string().regex(colorRegex, "Invalid hex color");

export const projectClassSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  color: colorSchema,
});

export const projectCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  classes: z.array(projectClassSchema).min(1),
});

export const projectUpdateSchema = projectCreateSchema.partial();

export const pointSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const pointWithLabelSchema = pointSchema.extend({
  label: z.union([z.literal(0), z.literal(1)]),
});

export const polygonSchema = z.array(z.array(pointSchema).min(3)).min(1);

const maskRleSchema = z.object({
  counts: z.string().min(1),
  size: z.tuple([z.number().int().positive(), z.number().int().positive()]),
});

const boundingBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

export const maskSchema = z.object({
  id: z.string().min(1),
  classId: z.string().min(1),
  className: z.string().min(1),
  color: colorSchema,
  polygon: polygonSchema.optional(),
  rle: maskRleSchema.optional(),
  boundingBox: boundingBoxSchema.optional(),
  source: z.enum(["sam3_click", "sam3_auto", "sam3_semantic", "manual"]),
}).superRefine((value, ctx) => {
  if (!value.polygon && !value.rle) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "polygon or rle is required for masks",
      path: ["polygon"],
    });
  }
});

export const imageStatusSchema = z.enum(["unlabeled", "in_progress", "labeled"]);

export const imageMetaSchema = z.object({
  fileName: z.string().min(1),
  width: z.number().positive(),
  height: z.number().positive(),
  status: imageStatusSchema,
  tags: z.array(z.string()).optional(),
});

export const imageRecordSchema = z.object({
  imageId: z.string().min(1),
  videoId: z.string().nullable(),
  masks: z.array(maskSchema),
  labellerId: z.string().nullable(),
  meta: imageMetaSchema,
});

export const imageUpdateSchema = z
  .object({
    videoId: z.string().nullable().optional(),
    masks: z.array(maskSchema).optional(),
    labellerId: z.string().nullable().optional(),
    meta: imageMetaSchema.partial().optional(),
  })
  .superRefine((value, ctx) => {
    const hasUpdate =
      value.videoId !== undefined ||
      value.masks !== undefined ||
      value.labellerId !== undefined ||
      value.meta !== undefined;
    if (!hasUpdate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one field must be provided",
      });
    }
  });

const segmentLegacyRequestSchema = z
  .object({
    projectId: z.string().min(1).optional(),
    imageId: z.string().min(1).optional(),
    imageUrl: z.string().url().optional(),
    image: z.string().min(1).optional(),
    imageBase64: z.string().min(1).optional(),
    mode: z.enum(["click", "auto", "semantic"]),
    points: z.array(pointWithLabelSchema).optional(),
    box: z
      .object({
        x1: z.number(),
        y1: z.number(),
        x2: z.number(),
        y2: z.number(),
      })
      .optional(),
    prompt: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    const hasProjectId = Boolean(value.projectId);
    const hasImageId = Boolean(value.imageId);
    if (hasProjectId !== hasImageId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "projectId and imageId must be provided together",
        path: ["projectId"],
      });
    }

    const hasImageInput =
      Boolean(value.imageUrl) ||
      Boolean(value.image) ||
      Boolean(value.imageBase64) ||
      (hasProjectId && hasImageId);
    if (!hasImageInput) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "imageUrl, image/imageBase64, or projectId + imageId is required",
        path: ["imageUrl"],
      });
    }

    if (value.mode === "click" && (!value.points || value.points.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "points are required for click mode",
        path: ["points"],
      });
    }

    if (value.mode === "semantic" && !value.prompt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "prompt is required for semantic mode",
        path: ["prompt"],
      });
    }
  });

const segmentSam3RequestSchema = z
  .object({
    type: z.string().min(1),
    projectId: z.string().min(1).optional(),
    imageId: z.string().min(1).optional(),
    resourceUrl: z.string().url().optional(),
    resource_url: z.string().url().optional(),
    resourcePath: z.string().min(1).optional(),
    resource_path: z.string().min(1).optional(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    const hasProjectId = Boolean(value.projectId);
    const hasImageId = Boolean(value.imageId);
    if (hasProjectId !== hasImageId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "projectId and imageId must be provided together",
        path: ["projectId"],
      });
    }

    if (value.type === "start_session") {
      const hasResource =
        Boolean(value.resourceUrl) ||
        Boolean(value.resource_url) ||
        Boolean(value.resourcePath) ||
        Boolean(value.resource_path) ||
        (hasProjectId && hasImageId);

      if (!hasResource) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "resourceUrl/resourcePath or projectId + imageId is required",
          path: ["resourceUrl"],
        });
      }
    }
  });

export const segmentRequestSchema = z.union([
  segmentSam3RequestSchema,
  segmentLegacyRequestSchema,
]);

export const lockAcquireSchema = z.object({
  imageIds: z.array(z.string().min(1)).min(1),
  userId: z.string().min(1),
  durationMs: z.number().positive().optional(),
});

export const lockReleaseSchema = z.object({
  imageIds: z.array(z.string().min(1)).min(1),
  userId: z.string().min(1),
});
