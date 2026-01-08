import type { ImageStatus } from './image';
/**
 * Assignment strategy types
 */
export type AssignmentStrategy = 'count' | 'images' | 'unassign' | 'rebalance';
/**
 * Unified assignment request payload
 */
export interface AssignRequest {
    assignTo?: string | null;
    strategy: AssignmentStrategy;
    count?: number;
    imageIds?: string[];
    unassignFrom?: string;
    unassignFilter?: 'all' | 'unlabeled' | 'assigned';
    distributeAmong?: string[];
    distributeMode?: 'equal' | 'weighted';
    weights?: Record<string, number>;
    filters?: {
        status?: ImageStatus[];
        currentAssignee?: string | null;
    };
    priority?: 'random' | 'oldest' | 'newest';
}
/**
 * Assignment operation result
 */
export interface AssignResponse {
    success: boolean;
    assigned: Record<string, number>;
    summary: {
        totalMoved: number;
        poolRemaining: number;
    };
}
/**
 * Lock configuration constants
 */
export interface LockConfig {
    threshold: number;
    durationMs: number;
}
//# sourceMappingURL=assignment.d.ts.map