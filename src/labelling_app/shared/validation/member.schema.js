"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateMemberSchema = exports.inviteMemberSchema = void 0;
const zod_1 = require("zod");
/**
 * Project role schema
 */
const projectRoleSchema = zod_1.z.enum(['owner', 'admin', 'labeler']);
/**
 * Schema for inviting a member
 */
exports.inviteMemberSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    role: projectRoleSchema,
    quota: zod_1.z.number().positive().nullable().optional(),
});
/**
 * Schema for updating a member
 */
exports.updateMemberSchema = zod_1.z.object({
    role: projectRoleSchema.optional(),
    quota: zod_1.z.number().positive().nullable().optional(),
});
