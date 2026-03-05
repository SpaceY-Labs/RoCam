export function getErrorMessage(error: unknown): string {
  if (
    error instanceof Object &&
    'message' in error &&
    typeof error.message === 'string'
  )
    return error.message

  return String(JSON.stringify(error) ?? 'Unknown error')
}
