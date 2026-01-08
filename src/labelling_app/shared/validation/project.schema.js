"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectIdSchema = exports.updateProjectSchema = exports.createProjectSchema = void 0;
const zod_1 = require("zod");
/**
 * Schema for creating a new project
 */
exports.createProjectSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(100),
    description: zod_1.z.string().max(1000).optional(),
});
/**
 * Schema for updating a project
 */
exports.updateProjectSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(100).optional(),
    description: zod_1.z.string().max(1000).optional(),
});
/**
 * Schema for project ID param
 */
exports.projectIdSchema = zod_1.z.object({
    projectId: zod_1.z.string().min(1),
});
