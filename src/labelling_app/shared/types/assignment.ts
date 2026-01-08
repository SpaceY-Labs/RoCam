import type { ImageStatus } from './image';

/**
 * Assignment strategy types
 */
export type AssignmentStrategy = 'count' | 'images' | 'unassign' | 'rebalance';

/**
 * Unified assignment request payload
 */
export interface AssignRequest {
  // WHO to assign
  assignTo?: string | null;

  // WHAT strategy
  strategy: AssignmentStrategy;

  // Strategy: "count"
  count?: number;

  // Strategy: "images"
  imageIds?: string[];

  // Strategy: "unassign"
  unassignFrom?: string;
  unassignFilter?: 'all' | 'unlabeled' | 'assigned';

  // Strategy: "rebalance"
  distributeAmong?: string[];
  distributeMode?: 'equal' | 'weighted';
  weights?: Record<string, number>;

  // Filters
  filters?: {
    status?: ImageStatus[];
    currentAssignee?: string | null;
  };

  // Options
  priority?: 'random' | 'oldest' | 'newest';
}

/**
 * Assignment operation result
 */
export interface AssignResponse {
  success: boolean;
  assigned: Record<string, number>; // userId -> count
  summary: {
    totalMoved: number;
    poolRemaining: number;
  };
}

/**
 * Lock configuration constants
 */
export interface LockConfig {
  threshold: number; // Images below this count are unlocked
  durationMs: number; // Lock duration in milliseconds
}
