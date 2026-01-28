/**
 * useNotifications - Hook for managing notification messages
 * Handles success/error banners with auto-dismiss functionality
 */

import { useCallback, useState } from 'react';

// ============ Constants ============
const DEFAULT_AUTO_DISMISS_MS = 3000;

// ============ Types ============
export interface UseNotificationsReturn {
  /** Current notification message (success) */
  notification: string | null;
  /** Current error message */
  error: string | null;
  /** Show a success notification */
  showNotification: (message: string, autoDismiss?: boolean) => void;
  /** Show an error message */
  showError: (message: string | Error | unknown, fallback?: string) => void;
  /** Clear the notification */
  clearNotification: () => void;
  /** Clear the error */
  clearError: () => void;
  /** Clear all messages */
  clearAll: () => void;
}

// ============ Helpers ============

/**
 * Extract error message from various error types
 */
const getErrorMessage = (err: unknown, fallback: string): string => {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return fallback;
};

// ============ Hook ============

/**
 * Manages notification and error state
 * @param autoDismissMs Time in ms before auto-dismissing notifications (default: 3000)
 * @returns Notification state and handlers
 */
export function useNotifications(
  autoDismissMs: number = DEFAULT_AUTO_DISMISS_MS
): UseNotificationsReturn {
  const [notification, setNotification] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Show a success notification with optional auto-dismiss
   */
  const showNotification = useCallback(
    (message: string, autoDismiss: boolean = true) => {
      setNotification(message);
      if (autoDismiss) {
        setTimeout(() => setNotification(null), autoDismissMs);
      }
    },
    [autoDismissMs]
  );

  /**
   * Show an error message
   */
  const showError = useCallback(
    (err: string | Error | unknown, fallback: string = 'An error occurred') => {
      const message = typeof err === 'string' ? err : getErrorMessage(err, fallback);
      setError(message);
    },
    []
  );

  /**
   * Clear the notification
   */
  const clearNotification = useCallback(() => {
    setNotification(null);
  }, []);

  /**
   * Clear the error
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  /**
   * Clear all messages
   */
  const clearAll = useCallback(() => {
    setNotification(null);
    setError(null);
  }, []);

  return {
    notification,
    error,
    showNotification,
    showError,
    clearNotification,
    clearError,
    clearAll,
  };
}

export default useNotifications;
