import { z } from 'zod';
import { EXPORT_FORMATS } from '../constants/formats.js';

/**
 * Export format schema
 */
const exportFormatSchema = z.enum(
  [...EXPORT_FORMATS] as [string, ...string[]]
);

/**
 * Export filters schema
 */
const exportFiltersSchema = z.object({
  status: z.array(z.enum(['unlabeled', 'assigned', 'in_progress', 'labeled'])).optional(),
  assignedTo: z.string().optional(),
  labeledBy: z.string().optional(),
  classIds: z.array(z.string()).optional(),
});

/**
 * Schema for starting an export
 */
export const startExportSchema = z.object({
  format: exportFormatSchema,
  filters: exportFiltersSchema.optional(),
});

// Type inference helpers
export type StartExportInput = z.infer<typeof startExportSchema>;
