"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startExportSchema = void 0;
const zod_1 = require("zod");
const formats_1 = require("../constants/formats");
/**
 * Export format schema
 */
const exportFormatSchema = zod_1.z.enum([...formats_1.EXPORT_FORMATS]);
/**
 * Export filters schema
 */
const exportFiltersSchema = zod_1.z.object({
    status: zod_1.z.array(zod_1.z.enum(['unlabeled', 'assigned', 'in_progress', 'labeled'])).optional(),
    assignedTo: zod_1.z.string().optional(),
    labeledBy: zod_1.z.string().optional(),
    classIds: zod_1.z.array(zod_1.z.string()).optional(),
});
/**
 * Schema for starting an export
 */
exports.startExportSchema = zod_1.z.object({
    format: exportFormatSchema,
    filters: exportFiltersSchema.optional(),
});
