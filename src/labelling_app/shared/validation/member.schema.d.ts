import { z } from 'zod';
/**
 * Schema for inviting a member
 */
export declare const inviteMemberSchema: z.ZodObject<{
    email: z.ZodString;
    role: z.ZodEnum<["owner", "admin", "labeler"]>;
    quota: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    email: string;
    role: "owner" | "admin" | "labeler";
    quota?: number | null | undefined;
}, {
    email: string;
    role: "owner" | "admin" | "labeler";
    quota?: number | null | undefined;
}>;
/**
 * Schema for updating a member
 */
export declare const updateMemberSchema: z.ZodObject<{
    role: z.ZodOptional<z.ZodEnum<["owner", "admin", "labeler"]>>;
    quota: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    role?: "owner" | "admin" | "labeler" | undefined;
    quota?: number | null | undefined;
}, {
    role?: "owner" | "admin" | "labeler" | undefined;
    quota?: number | null | undefined;
}>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
//# sourceMappingURL=member.schema.d.ts.map