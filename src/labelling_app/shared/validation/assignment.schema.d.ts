import { z } from 'zod';
/**
 * Schema for assignment request
 */
export declare const assignRequestSchema: z.ZodEffects<z.ZodObject<{
    assignTo: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    strategy: z.ZodEnum<["count", "images", "unassign", "rebalance"]>;
    count: z.ZodOptional<z.ZodNumber>;
    imageIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    unassignFrom: z.ZodOptional<z.ZodString>;
    unassignFilter: z.ZodOptional<z.ZodEnum<["all", "unlabeled", "assigned"]>>;
    distributeAmong: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    distributeMode: z.ZodOptional<z.ZodEnum<["equal", "weighted"]>>;
    weights: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    filters: z.ZodOptional<z.ZodObject<{
        status: z.ZodOptional<z.ZodArray<z.ZodEnum<["unlabeled", "assigned", "in_progress", "labeled"]>, "many">>;
        currentAssignee: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        status?: ("unlabeled" | "assigned" | "in_progress" | "labeled")[] | undefined;
        currentAssignee?: string | null | undefined;
    }, {
        status?: ("unlabeled" | "assigned" | "in_progress" | "labeled")[] | undefined;
        currentAssignee?: string | null | undefined;
    }>>;
    priority: z.ZodOptional<z.ZodEnum<["random", "oldest", "newest"]>>;
}, "strip", z.ZodTypeAny, {
    strategy: "count" | "images" | "unassign" | "rebalance";
    count?: number | undefined;
    imageIds?: string[] | undefined;
    assignTo?: string | null | undefined;
    unassignFrom?: string | undefined;
    unassignFilter?: "unlabeled" | "assigned" | "all" | undefined;
    distributeAmong?: string[] | undefined;
    distributeMode?: "equal" | "weighted" | undefined;
    weights?: Record<string, number> | undefined;
    filters?: {
        status?: ("unlabeled" | "assigned" | "in_progress" | "labeled")[] | undefined;
        currentAssignee?: string | null | undefined;
    } | undefined;
    priority?: "random" | "oldest" | "newest" | undefined;
}, {
    strategy: "count" | "images" | "unassign" | "rebalance";
    count?: number | undefined;
    imageIds?: string[] | undefined;
    assignTo?: string | null | undefined;
    unassignFrom?: string | undefined;
    unassignFilter?: "unlabeled" | "assigned" | "all" | undefined;
    distributeAmong?: string[] | undefined;
    distributeMode?: "equal" | "weighted" | undefined;
    weights?: Record<string, number> | undefined;
    filters?: {
        status?: ("unlabeled" | "assigned" | "in_progress" | "labeled")[] | undefined;
        currentAssignee?: string | null | undefined;
    } | undefined;
    priority?: "random" | "oldest" | "newest" | undefined;
}>, {
    strategy: "count" | "images" | "unassign" | "rebalance";
    count?: number | undefined;
    imageIds?: string[] | undefined;
    assignTo?: string | null | undefined;
    unassignFrom?: string | undefined;
    unassignFilter?: "unlabeled" | "assigned" | "all" | undefined;
    distributeAmong?: string[] | undefined;
    distributeMode?: "equal" | "weighted" | undefined;
    weights?: Record<string, number> | undefined;
    filters?: {
        status?: ("unlabeled" | "assigned" | "in_progress" | "labeled")[] | undefined;
        currentAssignee?: string | null | undefined;
    } | undefined;
    priority?: "random" | "oldest" | "newest" | undefined;
}, {
    strategy: "count" | "images" | "unassign" | "rebalance";
    count?: number | undefined;
    imageIds?: string[] | undefined;
    assignTo?: string | null | undefined;
    unassignFrom?: string | undefined;
    unassignFilter?: "unlabeled" | "assigned" | "all" | undefined;
    distributeAmong?: string[] | undefined;
    distributeMode?: "equal" | "weighted" | undefined;
    weights?: Record<string, number> | undefined;
    filters?: {
        status?: ("unlabeled" | "assigned" | "in_progress" | "labeled")[] | undefined;
        currentAssignee?: string | null | undefined;
    } | undefined;
    priority?: "random" | "oldest" | "newest" | undefined;
}>;
export type AssignRequestInput = z.infer<typeof assignRequestSchema>;
//# sourceMappingURL=assignment.schema.d.ts.map