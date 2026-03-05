/**
 * Unit tests for src/utils/formatters.ts
 *
 * All functions are pure (no React/DOM dependency), so this runs in Node mode.
 */
import { describe, it, expect } from 'vitest'

import {
  formatDegrees,
  formatFps,
  formatPercent,
  clampPercent,
  calculateUsagePercent,
  formatTemperature,
  formatBytes,
  formatStorageUsedTotal,
  formatDuration,
  formatPower,
  formatDate,
  formatRecordingDuration,
  formatServerTime,
} from './formatters'

// ---------------------------------------------------------------------------
// formatDegrees
// ---------------------------------------------------------------------------
describe('formatDegrees', () => {
  it('rounds to 1 decimal and appends degree symbol', () => {
    expect(formatDegrees(10)).toBe('10°')
  })

  it('handles negative values', () => {
    expect(formatDegrees(-45)).toBe('-45°')
  })

  it('rounds fractional degrees', () => {
    expect(formatDegrees(10.15)).toBe('10.2°')
  })

  it('handles zero', () => {
    expect(formatDegrees(0)).toBe('0°')
  })
})

// ---------------------------------------------------------------------------
// formatFps
// ---------------------------------------------------------------------------
describe('formatFps', () => {
  it('returns fps as string with 1 decimal', () => {
    expect(formatFps(30)).toBe('30')
  })

  it('rounds correctly', () => {
    expect(formatFps(29.95)).toBe('30')
  })

  it('handles fractional fps', () => {
    expect(formatFps(59.94)).toBe('59.9')
  })
})

// ---------------------------------------------------------------------------
// formatPercent
// ---------------------------------------------------------------------------
describe('formatPercent', () => {
  it('appends percent sign', () => {
    expect(formatPercent(75)).toBe('75%')
  })

  it('rounds to 1 decimal', () => {
    expect(formatPercent(33.333)).toBe('33.3%')
  })

  it('handles zero', () => {
    expect(formatPercent(0)).toBe('0%')
  })
})

// ---------------------------------------------------------------------------
// clampPercent
// ---------------------------------------------------------------------------
describe('clampPercent', () => {
  it('returns value within 0-100 unchanged', () => {
    expect(clampPercent(50)).toBe(50)
  })

  it('clamps values above 100', () => {
    expect(clampPercent(150)).toBe(100)
  })

  it('clamps values below 0', () => {
    expect(clampPercent(-10)).toBe(0)
  })

  it('handles exact boundaries', () => {
    expect(clampPercent(0)).toBe(0)
    expect(clampPercent(100)).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// calculateUsagePercent
// ---------------------------------------------------------------------------
describe('calculateUsagePercent', () => {
  it('calculates percentage of used vs total', () => {
    expect(calculateUsagePercent(512, 1024)).toBeCloseTo(50)
  })

  it('returns 0 when total is 0', () => {
    expect(calculateUsagePercent(100, 0)).toBe(0)
  })

  it('returns 100 when used equals total', () => {
    expect(calculateUsagePercent(1024, 1024)).toBeCloseTo(100)
  })

  it('handles partial usage', () => {
    expect(calculateUsagePercent(1, 4)).toBeCloseTo(25)
  })
})

// ---------------------------------------------------------------------------
// formatTemperature
// ---------------------------------------------------------------------------
describe('formatTemperature', () => {
  it('formats celsius', () => {
    expect(formatTemperature(25, 'celsius')).toBe('25°C')
  })

  it('converts to fahrenheit correctly', () => {
    // 0°C → 32°F
    expect(formatTemperature(0, 'fahrenheit')).toBe('32°F')
  })

  it('100°C → 212°F', () => {
    expect(formatTemperature(100, 'fahrenheit')).toBe('212°F')
  })

  it('rounds celsius to 1 decimal', () => {
    expect(formatTemperature(36.667, 'celsius')).toBe('36.7°C')
  })
})

// ---------------------------------------------------------------------------
// formatBytes
// ---------------------------------------------------------------------------
describe('formatBytes', () => {
  it('formats bytes', () => {
    expect(formatBytes(500)).toBe('500B')
  })

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1KB')
  })

  it('formats megabytes', () => {
    expect(formatBytes(1024 * 1024)).toBe('1MB')
  })

  it('formats gigabytes', () => {
    expect(formatBytes(1024 ** 3)).toBe('1GB')
  })

  it('handles 0 bytes', () => {
    expect(formatBytes(0)).toBe('0B')
  })

  it('handles negative values as 0', () => {
    expect(formatBytes(-100)).toBe('0B')
  })
})

// ---------------------------------------------------------------------------
// formatStorageUsedTotal
// ---------------------------------------------------------------------------
describe('formatStorageUsedTotal', () => {
  it('formats used / total', () => {
    expect(formatStorageUsedTotal(1024, 2048)).toBe('1KB / 2KB')
  })
})

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------
describe('formatDuration', () => {
  it('formats zero duration', () => {
    expect(formatDuration(0)).toBe('0h 0m')
  })

  it('formats one hour', () => {
    expect(formatDuration(3600 * 1000)).toBe('1h 0m')
  })

  it('formats mixed hours and minutes', () => {
    expect(formatDuration((3600 + 90) * 1000)).toBe('1h 1m')
  })

  it('ignores seconds', () => {
    expect(formatDuration(59 * 1000)).toBe('0h 0m')
  })

  it('handles negative as zero', () => {
    expect(formatDuration(-1000)).toBe('0h 0m')
  })
})

// ---------------------------------------------------------------------------
// formatPower
// ---------------------------------------------------------------------------
describe('formatPower', () => {
  it('appends W suffix', () => {
    expect(formatPower(12.5)).toBe('12.5W')
  })

  it('rounds to 1 decimal', () => {
    expect(formatPower(12.34)).toBe('12.3W')
  })
})

// ---------------------------------------------------------------------------
// formatDate
// ---------------------------------------------------------------------------
describe('formatDate', () => {
  it('returns dash for null', () => {
    expect(formatDate(null)).toBe('—')
  })

  it('returns a non-empty string for valid timestamp', () => {
    const result = formatDate(1_700_000_000_000)

    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
    expect(result).not.toBe('—')
  })
})

// ---------------------------------------------------------------------------
// formatRecordingDuration
// ---------------------------------------------------------------------------
describe('formatRecordingDuration', () => {
  it('returns dash for null', () => {
    expect(formatRecordingDuration(null)).toBe('—')
  })

  it('formats HH:MM:SS for valid duration', () => {
    // 1h 2m 3s = 3723 seconds
    expect(formatRecordingDuration(3723 * 1000)).toBe('01:02:03')
  })

  it('pads single-digit values', () => {
    expect(formatRecordingDuration(5 * 1000)).toBe('00:00:05')
  })

  it('handles zero duration', () => {
    expect(formatRecordingDuration(0)).toBe('00:00:00')
  })
})

// ---------------------------------------------------------------------------
// formatServerTime
// ---------------------------------------------------------------------------
describe('formatServerTime', () => {
  it('returns a non-empty string for valid timestamp', () => {
    const result = formatServerTime(1_700_000_000_000)

    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('formats epoch 0 without throwing', () => {
    const result = formatServerTime(0)

    expect(typeof result).toBe('string')
  })
})
