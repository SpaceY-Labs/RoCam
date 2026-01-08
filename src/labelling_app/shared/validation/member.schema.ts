import { z } from 'zod';

/**
 * Project role schema
 */
const projectRoleSchema = z.enum(['owner', 'admin', 'labeler']);

/**
 * Schema for inviting a member
 */
export const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: projectRoleSchema,
  quota: z.number().positive().nullable().optional(),
});

/**
 * Schema for updating a member
 */
export const updateMemberSchema = z.object({
  role: projectRoleSchema.optional(),
  quota: z.number().positive().nullable().optional(),
});

// Type inference helpers
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
