/**
 * Author: Zifan Si
 * Date: 2026-04-05
 * Purpose: Provides shared frontend utility helpers for UI-facing errors.
 */
/** Extracts a readable message from thrown values used in toast and UI errors. */
export function getErrorMessage(error: unknown): string {
  if (
    error instanceof Object &&
    'message' in error &&
    typeof error.message === 'string'
  )
    return error.message

  return String(JSON.stringify(error) ?? 'Unknown error')
}
