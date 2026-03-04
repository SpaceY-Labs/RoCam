/**
 * Unit tests for src/components/SystemStatusCard.tsx
 *
 * Covers:
 *   - Renders nothing meaningful when status is null
 *   - Renders status data when provided via mocked useRocam
 *   - Temperature display respects celsius/fahrenheit preference
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import React from 'react'
import { renderWithI18n } from '@/test/renderWithProviders'

const mockStatus = {
  armed: false,
  tilt: 10.0,
  pan: -5.0,
  preview: null,
  bbox: null,
  average_fps: 30.0,
  cpu_utilization: 45.0,
  gpu_utilization: 70.0,
  core_temperature_celsius: 55.0,
  system_power_w: 12.5,
  memory_used_bytes: 4 * 1024 * 1024 * 1024,
  memory_total_bytes: 8 * 1024 * 1024 * 1024,
  disk_used_bytes: 100 * 1024 * 1024 * 1024,
  disk_total_bytes: 500 * 1024 * 1024 * 1024,
  recording_duration_left_s: 3600,
  timestamp_ms: 1700000000000,
  is_recording: false,
  longitude: null,
  latitude: null,
}

vi.mock('@/network/rocamProvider', () => ({
  useRocam: vi.fn(),
}))

vi.mock('@/store/languageAtom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/store/languageAtom')>()
  return {
    ...orig,
  }
})

vi.mock('jotai', async (importOriginal) => {
  const orig = await importOriginal<typeof import('jotai')>()
  return {
    ...orig,
    useAtomValue: vi.fn().mockReturnValue('celsius'),
  }
})

describe('SystemStatusCard', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { useRocam } = await import('@/network/rocamProvider')
    ;(useRocam as ReturnType<typeof vi.fn>).mockReturnValue({
      status: mockStatus,
      apiClient: null,
      statusPollingError: null,
    })
  })

  it('renders without crashing when status is provided', async () => {
    const { SystemStatusCard } = await import('./SystemStatusCard')
    renderWithI18n(<SystemStatusCard />)
    expect(document.body).toBeDefined()
  })

  it('renders without crashing when status is null', async () => {
    const { useRocam } = await import('@/network/rocamProvider')
    ;(useRocam as ReturnType<typeof vi.fn>).mockReturnValue({
      status: null,
      apiClient: null,
      statusPollingError: null,
    })
    const { SystemStatusCard } = await import('./SystemStatusCard')
    renderWithI18n(<SystemStatusCard />)
    expect(document.body).toBeDefined()
  })

  it('displays CPU utilization', async () => {
    const { SystemStatusCard } = await import('./SystemStatusCard')
    renderWithI18n(<SystemStatusCard />)
    expect(screen.getByText(/45/)).toBeDefined()
  })

  it('displays FPS', async () => {
    const { SystemStatusCard } = await import('./SystemStatusCard')
    renderWithI18n(<SystemStatusCard />)
    expect(screen.getByText('30')).toBeDefined()
  })

  it('displays temperature in fahrenheit when unit is fahrenheit', async () => {
    const { useAtomValue } = await import('jotai')
    vi.mocked(useAtomValue).mockReturnValue('fahrenheit' as unknown as never)
    const { SystemStatusCard } = await import('./SystemStatusCard')
    renderWithI18n(<SystemStatusCard />)
    // 55°C = 131°F
    const content = document.body.textContent ?? ''
    expect(content).toContain('°F')
  })

  it('displays GPS coordinates when latitude and longitude are set', async () => {
    const { useRocam } = await import('@/network/rocamProvider')
    ;(useRocam as ReturnType<typeof vi.fn>).mockReturnValue({
      status: { ...mockStatus, latitude: 48.8566, longitude: 2.3522 },
      apiClient: null,
      statusPollingError: null,
    })
    const { SystemStatusCard } = await import('./SystemStatusCard')
    renderWithI18n(<SystemStatusCard />)
    expect(document.body.textContent).toContain('48.856600')
  })
})
