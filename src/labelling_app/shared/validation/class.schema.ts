import { z } from 'zod';

/**
 * Hex color validation regex
 */
const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;

/**
 * Schema for creating a label class
 */
export const createClassSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().regex(hexColorRegex, 'Invalid hex color'),
});

/**
 * Schema for updating a label class
 */
export const updateClassSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  color: z.string().regex(hexColorRegex, 'Invalid hex color').optional(),
  order: z.number().nonnegative().optional(),
});

/**
 * Schema for reordering classes
 */
export const reorderClassesSchema = z.object({
  classIds: z.array(z.string()).min(1),
});

// Type inference helpers
export type CreateClassInput = z.infer<typeof createClassSchema>;
export type UpdateClassInput = z.infer<typeof updateClassSchema>;
