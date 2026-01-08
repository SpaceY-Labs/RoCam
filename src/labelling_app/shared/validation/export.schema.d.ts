import { z } from 'zod';
/**
 * Schema for starting an export
 */
export declare const startExportSchema: z.ZodObject<{
    format: z.ZodEnum<[string, ...string[]]>;
    filters: z.ZodOptional<z.ZodObject<{
        status: z.ZodOptional<z.ZodArray<z.ZodEnum<["unlabeled", "assigned", "in_progress", "labeled"]>, "many">>;
        assignedTo: z.ZodOptional<z.ZodString>;
        labeledBy: z.ZodOptional<z.ZodString>;
        classIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        status?: ("unlabeled" | "assigned" | "in_progress" | "labeled")[] | undefined;
        assignedTo?: string | undefined;
        classIds?: string[] | undefined;
        labeledBy?: string | undefined;
    }, {
        status?: ("unlabeled" | "assigned" | "in_progress" | "labeled")[] | undefined;
        assignedTo?: string | undefined;
        classIds?: string[] | undefined;
        labeledBy?: string | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    format: string;
    filters?: {
        status?: ("unlabeled" | "assigned" | "in_progress" | "labeled")[] | undefined;
        assignedTo?: string | undefined;
        classIds?: string[] | undefined;
        labeledBy?: string | undefined;
    } | undefined;
}, {
    format: string;
    filters?: {
        status?: ("unlabeled" | "assigned" | "in_progress" | "labeled")[] | undefined;
        assignedTo?: string | undefined;
        classIds?: string[] | undefined;
        labeledBy?: string | undefined;
    } | undefined;
}>;
export type StartExportInput = z.infer<typeof startExportSchema>;
//# sourceMappingURL=export.schema.d.ts.map