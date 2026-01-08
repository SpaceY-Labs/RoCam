import { z } from 'zod';
/**
 * Schema for creating a label class
 */
export declare const createClassSchema: z.ZodObject<{
    name: z.ZodString;
    color: z.ZodString;
}, "strip", z.ZodTypeAny, {
    name: string;
    color: string;
}, {
    name: string;
    color: string;
}>;
/**
 * Schema for updating a label class
 */
export declare const updateClassSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    color: z.ZodOptional<z.ZodString>;
    order: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    name?: string | undefined;
    color?: string | undefined;
    order?: number | undefined;
}, {
    name?: string | undefined;
    color?: string | undefined;
    order?: number | undefined;
}>;
/**
 * Schema for reordering classes
 */
export declare const reorderClassesSchema: z.ZodObject<{
    classIds: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    classIds: string[];
}, {
    classIds: string[];
}>;
export type CreateClassInput = z.infer<typeof createClassSchema>;
export type UpdateClassInput = z.infer<typeof updateClassSchema>;
//# sourceMappingURL=class.schema.d.ts.map