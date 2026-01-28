/**
 * useLockManagement - Hook for managing image locks
 * Handles lock acquisition, refresh, and release for labeling workflow
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { acquireLocks, releaseLocks } from '../modules/API_Helps';

// ============ Constants ============
const DEFAULT_LOCK_DURATION_MS = 20 * 60 * 1000; // 20 minutes
const DEFAULT_LOCK_REFRESH_MS = 5 * 60 * 1000; // 5 minutes

// ============ Types ============
export interface UseLockManagementOptions {
  /** Lock duration in ms (default: 20 minutes) */
  lockDurationMs?: number;
  /** Lock refresh interval in ms (default: 5 minutes) */
  lockRefreshMs?: number;
  /** Whether to auto-refresh locks */
  autoRefresh?: boolean;
}

export interface UseLockManagementReturn {
  /** Currently locked image IDs */
  lockedIds: string[];
  /** Whether lock operation is in progress */
  loading: boolean;
  /** Acquire locks for given image IDs */
  acquire: (projectId: string, imageIds: string[]) => Promise<string[]>;
  /** Release specific locks */
  release: (projectId: string, imageIds: string[]) => Promise<void>;
  /** Release all current locks */
  releaseAll: (projectId: string) => Promise<void>;
  /** Refresh existing locks */
  refresh: (projectId: string) => Promise<void>;
  /** Remove an image ID from locked list (local only) */
  removeLock: (imageId: string) => void;
  /** Clear all locks (local only) */
  clearLocks: () => void;
}

// ============ Hook ============

/**
 * Manages image lock state and operations
 * @param options Configuration options
 * @returns Lock state and handlers
 */
export function useLockManagement(
  options: UseLockManagementOptions = {}
): UseLockManagementReturn {
  const {
    lockDurationMs = DEFAULT_LOCK_DURATION_MS,
    lockRefreshMs = DEFAULT_LOCK_REFRESH_MS,
    autoRefresh = true,
  } = options;

  const [lockedIds, setLockedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const refreshTimerRef = useRef<number | null>(null);
  const projectIdRef = useRef<string | null>(null);

  // ============ Lock Operations ============

  /**
   * Acquire locks for given image IDs
   * @returns Array of successfully locked image IDs
   */
  const acquire = useCallback(
    async (projectId: string, imageIds: string[]): Promise<string[]> => {
      if (imageIds.length === 0) return [];

      setLoading(true);
      projectIdRef.current = projectId;

      try {
        const response = await acquireLocks(projectId, imageIds, lockDurationMs);

        const locked = (response.results || [])
          .filter((result) => result.locked)
          .map((result) => result.imageId);

        setLockedIds(locked);
        return locked;
      } catch (err) {
        console.error('Failed to acquire locks:', err);
        return [];
      } finally {
        setLoading(false);
      }
    },
    [lockDurationMs]
  );

  /**
   * Release specific locks
   */
  const release = useCallback(
    async (projectId: string, imageIds: string[]): Promise<void> => {
      if (imageIds.length === 0) return;

      try {
        await releaseLocks(projectId, imageIds);
        setLockedIds((prev) => prev.filter((id) => !imageIds.includes(id)));
      } catch (err) {
        console.warn('Failed to release locks:', err);
      }
    },
    []
  );

  /**
   * Release all current locks
   */
  const releaseAll = useCallback(
    async (projectId: string): Promise<void> => {
      if (lockedIds.length === 0) return;

      try {
        await releaseLocks(projectId, lockedIds);
        setLockedIds([]);
      } catch (err) {
        console.warn('Failed to release all locks:', err);
      }
    },
    [lockedIds]
  );

  /**
   * Refresh existing locks to extend their duration
   */
  const refresh = useCallback(
    async (projectId: string): Promise<void> => {
      if (lockedIds.length === 0) return;

      try {
        await acquireLocks(projectId, lockedIds, lockDurationMs);
      } catch (err) {
        console.error('Failed to refresh locks:', err);
      }
    },
    [lockedIds, lockDurationMs]
  );

  /**
   * Remove an image ID from locked list (local only)
   */
  const removeLock = useCallback((imageId: string) => {
    setLockedIds((prev) => prev.filter((id) => id !== imageId));
  }, []);

  /**
   * Clear all locks (local only)
   */
  const clearLocks = useCallback(() => {
    setLockedIds([]);
  }, []);

  // ============ Auto-Refresh Effect ============
  useEffect(() => {
    // Clear existing timer
    if (refreshTimerRef.current) {
      window.clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    // Don't set up refresh if disabled or no locks
    if (!autoRefresh || lockedIds.length === 0 || !projectIdRef.current) {
      return;
    }

    // Set up periodic refresh
    refreshTimerRef.current = window.setInterval(() => {
      if (projectIdRef.current) {
        refresh(projectIdRef.current);
      }
    }, lockRefreshMs);

    return () => {
      if (refreshTimerRef.current) {
        window.clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [autoRefresh, lockedIds.length, lockRefreshMs, refresh]);

  return {
    lockedIds,
    loading,
    acquire,
    release,
    releaseAll,
    refresh,
    removeLock,
    clearLocks,
  };
}

export default useLockManagement;
