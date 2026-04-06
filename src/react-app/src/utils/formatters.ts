/**
 * Author: Zifan Si
 * Date: 2026-03-04
 * Purpose: Provides shared formatting helpers for frontend status and recording data.
 */
import type { TemperatureUnit } from '@/store/settingsAtom'

/**
 * Formats an angle value for dashboard display.
 *
 * @param degrees Angle value in degrees.
 * @returns Rounded degree string with a trailing degree symbol.
 */
export function formatDegrees(degrees: number): string {
  return `${Math.round(degrees * 10) / 10}°`
}

/**
 * Formats a frames-per-second value for compact status display.
 *
 * @param fps Frames per second reported by the backend.
 * @returns Rounded FPS string without a unit suffix.
 */
export function formatFps(fps: number): string {
  return `${Math.round(fps * 10) / 10}`
}

/**
 * Formats a numeric percentage for UI display.
 *
 * @param value Percentage value before string formatting.
 * @returns Rounded percentage string with a trailing percent sign.
 */
export function formatPercent(value: number): string {
  return `${Math.round(value * 10) / 10}%`
}

/**
 * Restricts a percentage value to the standard 0-100 range.
 *
 * @param value Percentage value that may be outside the display range.
 * @returns Clamped percentage value between 0 and 100.
 */
export function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

/**
 * Calculates the used-versus-total percentage for a resource.
 *
 * @param used Used amount of the resource.
 * @param total Total available amount of the resource.
 * @returns Percentage of the resource currently in use.
 */
export function calculateUsagePercent(used: number, total: number): number {
  return total <= 0 ? 0 : (used / total) * 100
}

/**
 * Formats a temperature value according to the selected unit preference.
 *
 * @param celsius Temperature in degrees Celsius.
 * @param unit Preferred temperature unit for display.
 * @returns Rounded temperature string in the selected unit.
 */
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

/**
 * Formats a byte count into human-readable storage units.
 *
 * @param bytes Raw byte count.
 * @returns Rounded storage string using the most suitable unit.
 */
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

/**
 * Formats used and total storage values as a single status string.
 *
 * @param used Used storage in bytes.
 * @param total Total storage in bytes.
 * @returns Combined used-versus-total storage string.
 */
export function formatStorageUsedTotal(used: number, total: number): string {
  return `${formatBytes(used)} / ${formatBytes(total)}`
}

/**
 * Formats a duration in milliseconds into hours and minutes.
 *
 * @param durationMs Duration in milliseconds.
 * @returns Human-readable duration string for dashboard display.
 */
export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)

  return `${hours}h ${minutes}m`
}

/**
 * Formats a power reading for compact system status display.
 *
 * @param watts Power draw in watts.
 * @returns Rounded wattage string with a trailing unit suffix.
 */
export function formatPower(watts: number): string {
  return `${Math.round(watts * 10) / 10}W`
}

/**
 * Formats a backend timestamp using the local date-time representation.
 *
 * @param timestampMs Unix timestamp in milliseconds.
 * @returns Localized date-time string for server time display.
 */
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

/**
 * Formats a recording timestamp for list display.
 *
 * @param timestampMs Recording start timestamp in milliseconds, or `null` when absent.
 * @returns Localized date-time string, or an em dash when the value is unavailable.
 */
export function formatDate(timestampMs: number | null): string {
  if (timestampMs === null) return '—'

  return new Date(timestampMs).toLocaleString()
}

/**
 * Formats a recording duration in milliseconds as `HH:MM:SS`.
 *
 * @param durationMs Recording duration in milliseconds, or `null` when absent.
 * @returns Padded recording duration string, or an em dash when unavailable.
 */
export function formatRecordingDuration(durationMs: number | null): string {
  if (durationMs === null) return '—'
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60

  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
