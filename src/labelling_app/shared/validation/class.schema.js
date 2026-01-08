"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reorderClassesSchema = exports.updateClassSchema = exports.createClassSchema = void 0;
const zod_1 = require("zod");
/**
 * Hex color validation regex
 */
const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
/**
 * Schema for creating a label class
 */
exports.createClassSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(50),
    color: zod_1.z.string().regex(hexColorRegex, 'Invalid hex color'),
});
/**
 * Schema for updating a label class
 */
exports.updateClassSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(50).optional(),
    color: zod_1.z.string().regex(hexColorRegex, 'Invalid hex color').optional(),
    order: zod_1.z.number().nonnegative().optional(),
});
/**
 * Schema for reordering classes
 */
exports.reorderClassesSchema = zod_1.z.object({
    classIds: zod_1.z.array(zod_1.z.string()).min(1),
});
