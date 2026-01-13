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

export const maskSchema = z.object({
  id: z.string().min(1),
  classId: z.string().min(1),
  className: z.string().min(1),
  color: colorSchema,
  polygon: polygonSchema,
  source: z.enum(["sam3_click", "sam3_auto", "sam3_semantic", "manual"]),
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

export const segmentRequestSchema = z
  .object({
    projectId: z.string().min(1),
    imageId: z.string().min(1),
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

export const lockAcquireSchema = z.object({
  imageIds: z.array(z.string().min(1)).min(1),
  userId: z.string().min(1),
  durationMs: z.number().positive().optional(),
});

export const lockReleaseSchema = z.object({
  imageIds: z.array(z.string().min(1)).min(1),
  userId: z.string().min(1),
});
