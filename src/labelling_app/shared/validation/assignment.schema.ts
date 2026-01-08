import { z } from 'zod';

/**
 * Assignment strategy schema
 */
const strategySchema = z.enum(['count', 'images', 'unassign', 'rebalance']);

/**
 * Schema for assignment request
 */
export const assignRequestSchema = z
  .object({
    // WHO
    assignTo: z.string().nullable().optional(),

    // WHAT
    strategy: strategySchema,

    // Strategy: count
    count: z.number().positive().optional(),

    // Strategy: images
    imageIds: z.array(z.string()).optional(),

    // Strategy: unassign
    unassignFrom: z.string().optional(),
    unassignFilter: z.enum(['all', 'unlabeled', 'assigned']).optional(),

    // Strategy: rebalance
    distributeAmong: z.array(z.string()).optional(),
    distributeMode: z.enum(['equal', 'weighted']).optional(),
    weights: z.record(z.string(), z.number().positive()).optional(),

    // Filters
    filters: z
      .object({
        status: z
          .array(z.enum(['unlabeled', 'assigned', 'in_progress', 'labeled']))
          .optional(),
        currentAssignee: z.string().nullable().optional(),
      })
      .optional(),

    // Options
    priority: z.enum(['random', 'oldest', 'newest']).optional(),
  })
  .refine(
    (data) => {
      // Validate strategy-specific fields
      switch (data.strategy) {
        case 'count':
          return data.count !== undefined && data.assignTo !== undefined;
        case 'images':
          return data.imageIds !== undefined && data.imageIds.length > 0;
        case 'unassign':
          return data.unassignFrom !== undefined;
        case 'rebalance':
          return (
            data.distributeAmong !== undefined && data.distributeAmong.length > 0
          );
        default:
          return false;
      }
    },
    { message: 'Invalid strategy configuration' }
  );

// Type inference helpers
export type AssignRequestInput = z.infer<typeof assignRequestSchema>;
