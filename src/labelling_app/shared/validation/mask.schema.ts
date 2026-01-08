import { z } from 'zod';

/**
 * Point coordinate schema
 */
const pointSchema = z.object({
  x: z.number(),
  y: z.number(),
});

/**
 * Bounding box schema
 */
const bboxSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
});

/**
 * Polygon mask data schema
 */
const maskDataSchema = z.object({
  type: z.literal('polygon'),
  polygon: z.array(z.array(pointSchema).min(3)), // At least 3 points per ring
});

/**
 * Mask source schema
 */
const maskSourceSchema = z.enum([
  'sam3_auto',
  'sam3_click',
  'sam3_semantic',
  'manual',
]);

/**
 * Single mask creation schema
 */
export const createMaskSchema = z.object({
  classId: z.string().min(1),
  data: maskDataSchema,
  boundingBox: bboxSchema,
  area: z.number().nonnegative(),
  source: maskSourceSchema,
});

/**
 * Bulk save masks schema (replaces all masks for image)
 */
export const saveMasksSchema = z.object({
  masks: z.array(createMaskSchema),
});

// Type inference helpers
export type CreateMaskInput = z.infer<typeof createMaskSchema>;
export type SaveMasksInput = z.infer<typeof saveMasksSchema>;
