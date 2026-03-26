/**
 * Pure formatting utilities shared across components.
 * Extracted to enable isolated unit testing without React/JSX dependencies.
 */
import type { TemperatureUnit } from '@/store/languageAtom'

export function formatDegrees(degrees: number): string {
  return `${Math.round(degrees * 10) / 10}°`
}

export function formatFps(fps: number): string {
  return `${Math.round(fps * 10) / 10}`
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 10) / 10}%`
}

export function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

export function calculateUsagePercent(used: number, total: number): number {
  return total <= 0 ? 0 : (used / total) * 100
}

export function formatTemperature(
  celsius: number,
  unit: TemperatureUnit
): string {
  if (unit === 'fahrenheit') {
    const fahrenheit = (celsius * 9) / 5 + 32

    return `${Math.round(fahrenheit * 10) / 10}°F`
  }

  return `${Math.round(celsius * 10) / 10}°C`
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = Math.max(0, bytes)
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${Math.round(value * 10) / 10}${units[unitIndex]}`
}

export function formatStorageUsedTotal(used: number, total: number): string {
  return `${formatBytes(used)} / ${formatBytes(total)}`
}

export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)

  return `${hours}h ${minutes}m`
}

export function formatPower(watts: number): string {
  return `${Math.round(watts * 10) / 10}W`
}

export function formatServerTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleString(undefined, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** Formats a date for display in a Recording list item. */
export function formatDate(timestampMs: number | null): string {
  if (timestampMs === null) return '—'

  return new Date(timestampMs).toLocaleString()
}

/** Formats a duration in ms to HH:MM:SS string for recordings. */
export function formatRecordingDuration(durationMs: number | null): string {
  if (durationMs === null) return '—'
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60

  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
