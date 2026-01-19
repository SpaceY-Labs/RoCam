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

export const maskValueSchema = z.union([z.literal(0), z.literal(1), z.boolean()]);
const maskRowSchema = z.array(maskValueSchema).min(1);
export const maskTensorSchema = z.array(maskRowSchema).min(1);

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
  mask: maskTensorSchema.optional(),
  boundingBox: boundingBoxSchema.optional(),
  source: z.enum(["sam2_click", "sam2_auto", "sam2_semantic", "manual"]),
}).superRefine((value, ctx) => {
  if (!value.mask && !value.boundingBox) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "mask or boundingBox is required",
      path: ["mask"],
    });
  }
  if (value.source !== "manual" && !value.mask) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "mask is required for SAM masks",
      path: ["mask"],
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
    projectId: z.string().min(1),
    imageId: z.string().min(1),
    mode: z.enum(["auto"]),
    prompt: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === "auto" && value.prompt !== undefined && value.prompt.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "prompt must be non-empty when provided",
        path: ["prompt"],
      });
    }
  });

export const segmentRequestSchema = segmentLegacyRequestSchema;

export const lockAcquireSchema = z.object({
  imageIds: z.array(z.string().min(1)).min(1),
  userId: z.string().min(1),
  durationMs: z.number().positive().optional(),
});

export const lockReleaseSchema = z.object({
  imageIds: z.array(z.string().min(1)).min(1),
  userId: z.string().min(1),
});
