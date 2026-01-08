"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assignRequestSchema = void 0;
const zod_1 = require("zod");
/**
 * Assignment strategy schema
 */
const strategySchema = zod_1.z.enum(['count', 'images', 'unassign', 'rebalance']);
/**
 * Schema for assignment request
 */
exports.assignRequestSchema = zod_1.z
    .object({
    // WHO
    assignTo: zod_1.z.string().nullable().optional(),
    // WHAT
    strategy: strategySchema,
    // Strategy: count
    count: zod_1.z.number().positive().optional(),
    // Strategy: images
    imageIds: zod_1.z.array(zod_1.z.string()).optional(),
    // Strategy: unassign
    unassignFrom: zod_1.z.string().optional(),
    unassignFilter: zod_1.z.enum(['all', 'unlabeled', 'assigned']).optional(),
    // Strategy: rebalance
    distributeAmong: zod_1.z.array(zod_1.z.string()).optional(),
    distributeMode: zod_1.z.enum(['equal', 'weighted']).optional(),
    weights: zod_1.z.record(zod_1.z.string(), zod_1.z.number().positive()).optional(),
    // Filters
    filters: zod_1.z
        .object({
        status: zod_1.z
            .array(zod_1.z.enum(['unlabeled', 'assigned', 'in_progress', 'labeled']))
            .optional(),
        currentAssignee: zod_1.z.string().nullable().optional(),
    })
        .optional(),
    // Options
    priority: zod_1.z.enum(['random', 'oldest', 'newest']).optional(),
})
    .refine((data) => {
    // Validate strategy-specific fields
    switch (data.strategy) {
        case 'count':
            return data.count !== undefined && data.assignTo !== undefined;
        case 'images':
            return data.imageIds !== undefined && data.imageIds.length > 0;
        case 'unassign':
            return data.unassignFrom !== undefined;
        case 'rebalance':
            return (data.distributeAmong !== undefined && data.distributeAmong.length > 0);
        default:
            return false;
    }
}, { message: 'Invalid strategy configuration' });
