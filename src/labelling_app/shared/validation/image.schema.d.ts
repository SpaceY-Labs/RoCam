import { z } from 'zod';
/**
 * Schema for requesting upload URLs
 */
export declare const getUploadUrlsSchema: z.ZodObject<{
    files: z.ZodArray<z.ZodObject<{
        fileName: z.ZodString;
        contentType: z.ZodEnum<[string, ...string[]]>;
        size: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        fileName: string;
        contentType: string;
        size: number;
    }, {
        fileName: string;
        contentType: string;
        size: number;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    files: {
        fileName: string;
        contentType: string;
        size: number;
    }[];
}, {
    files: {
        fileName: string;
        contentType: string;
        size: number;
    }[];
}>;
/**
 * Schema for confirming uploads
 */
export declare const confirmUploadSchema: z.ZodObject<{
    imageIds: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    imageIds: string[];
}, {
    imageIds: string[];
}>;
/**
 * Schema for image list query params
 */
export declare const imageListQuerySchema: z.ZodObject<{
    status: z.ZodOptional<z.ZodEnum<["unlabeled", "assigned", "in_progress", "labeled"]>>;
    assignedTo: z.ZodOptional<z.ZodString>;
    cursor: z.ZodOptional<z.ZodString>;
    limit: z.ZodOptional<z.ZodNumber>;
    orderBy: z.ZodOptional<z.ZodEnum<["uploadedAt", "assignedAt", "status"]>>;
    orderDirection: z.ZodOptional<z.ZodEnum<["asc", "desc"]>>;
}, "strip", z.ZodTypeAny, {
    limit?: number | undefined;
    status?: "unlabeled" | "assigned" | "in_progress" | "labeled" | undefined;
    assignedTo?: string | undefined;
    cursor?: string | undefined;
    orderBy?: "uploadedAt" | "assignedAt" | "status" | undefined;
    orderDirection?: "asc" | "desc" | undefined;
}, {
    limit?: number | undefined;
    status?: "unlabeled" | "assigned" | "in_progress" | "labeled" | undefined;
    assignedTo?: string | undefined;
    cursor?: string | undefined;
    orderBy?: "uploadedAt" | "assignedAt" | "status" | undefined;
    orderDirection?: "asc" | "desc" | undefined;
}>;
/**
 * Schema for bulk delete
 */
export declare const bulkDeleteSchema: z.ZodObject<{
    imageIds: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    imageIds: string[];
}, {
    imageIds: string[];
}>;
export type GetUploadUrlsInput = z.infer<typeof getUploadUrlsSchema>;
export type ConfirmUploadInput = z.infer<typeof confirmUploadSchema>;
export type ImageListQuery = z.infer<typeof imageListQuerySchema>;
//# sourceMappingURL=image.schema.d.ts.map