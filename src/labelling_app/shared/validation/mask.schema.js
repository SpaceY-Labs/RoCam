"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveMasksSchema = exports.createMaskSchema = void 0;
const zod_1 = require("zod");
/**
 * Point coordinate schema
 */
const pointSchema = zod_1.z.object({
    x: zod_1.z.number(),
    y: zod_1.z.number(),
});
/**
 * Bounding box schema
 */
const bboxSchema = zod_1.z.object({
    x: zod_1.z.number(),
    y: zod_1.z.number(),
    w: zod_1.z.number().positive(),
    h: zod_1.z.number().positive(),
});
/**
 * Polygon mask data schema
 */
const maskDataSchema = zod_1.z.object({
    type: zod_1.z.literal('polygon'),
    polygon: zod_1.z.array(zod_1.z.array(pointSchema).min(3)), // At least 3 points per ring
});
/**
 * Mask source schema
 */
const maskSourceSchema = zod_1.z.enum([
    'sam3_auto',
    'sam3_click',
    'sam3_semantic',
    'manual',
]);
/**
 * Single mask creation schema
 */
exports.createMaskSchema = zod_1.z.object({
    classId: zod_1.z.string().min(1),
    data: maskDataSchema,
    boundingBox: bboxSchema,
    area: zod_1.z.number().nonnegative(),
    source: maskSourceSchema,
});
/**
 * Bulk save masks schema (replaces all masks for image)
 */
exports.saveMasksSchema = zod_1.z.object({
    masks: zod_1.z.array(exports.createMaskSchema),
});
