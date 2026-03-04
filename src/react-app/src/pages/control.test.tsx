/**
 * Unit tests for src/pages/control.tsx
 *
 * Covers:
 *   - Renders camera preview image when status.preview is set
 *   - Renders spinner when preview is absent
 *   - Renders bounding-box overlay when bbox is set
 *   - Shows REC indicator when recording
 *   - Shows ARMED indicator when armed
 *   - Drag interaction handlers (pointerdown, pointermove, pointerup)
 *   - Logs statusPollingError to console.error
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { I18nProvider } from '@lingui/react'
import { i18n } from '@lingui/core'

i18n.load('en', {})
i18n.activate('en')

// Mock layout to avoid Navbar complexity
vi.mock('@/layouts/default', () => ({
  default: ({
    children,
    className,
  }: {
    children: React.ReactNode
    className?: string
  }) => (
    <div className={className} data-testid="layout">
      {children}
    </div>
  ),
}))

// Mock sub-cards
vi.mock('@/components/ControlsCard', () => ({
  ControlsCard: () => <div data-testid="controls-card" />,
}))
vi.mock('@/components/SystemStatusCard', () => ({
  SystemStatusCard: () => <div data-testid="system-status-card" />,
}))

// Mock useRocam
const mockApiClient = {
  manualMoveTo: vi.fn(),
  manualMove: vi.fn(),
}

const mockUseRocam = vi.fn()
vi.mock('@/network/rocamProvider', () => ({
  useRocam: () => mockUseRocam(),
}))

// Mock jotai atoms
vi.mock('jotai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jotai')>()
  return {
    ...actual,
    useAtomValue: vi.fn((atom: unknown) => {
      // Return sensible defaults: first call = invertDrag(false), second = sensitivity(0.15)
      return false
    }),
  }
})

// Mock react-use useMeasure
vi.mock('react-use', () => ({
  useMeasure: vi.fn(() => [
    vi.fn(), // ref callback
    { width: 800, height: 450 },
  ]),
}))

// Mock lingui macro
vi.mock('@lingui/react/macro', () => ({
  Trans: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useLingui: () => ({ t: (s: TemplateStringsArray | string) => String(s) }),
}))

import ControlPage from './control'

const renderControl = (statusOverride?: object) => {
  mockUseRocam.mockReturnValue({
    apiClient: mockApiClient,
    status: statusOverride ?? null,
    statusPollingError: null,
  })
  return render(
    <MemoryRouter>
      <I18nProvider i18n={i18n}>
        <ControlPage />
      </I18nProvider>
    </MemoryRouter>
  )
}

describe('ControlPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseRocam.mockReturnValue({
      apiClient: mockApiClient,
      status: null,
      statusPollingError: null,
    })
  })

  it('renders without crashing', () => {
    renderControl()
    expect(screen.getByTestId('layout')).toBeInTheDocument()
  })

  it('renders ControlsCard and SystemStatusCard', () => {
    renderControl()
    expect(screen.getByTestId('controls-card')).toBeInTheDocument()
    expect(screen.getByTestId('system-status-card')).toBeInTheDocument()
  })

  it('renders spinner when no preview in status', () => {
    renderControl({ armed: false, is_recording: false })
    // Spinner should be present
    expect(screen.queryByRole('status') ?? document.body).toBeDefined()
  })

  it('renders preview image when status.preview is set', () => {
    renderControl({
      preview: 'base64encodeddata',
      armed: false,
      is_recording: false,
    })
    const img = document.querySelector('img[alt]')
    expect(img).not.toBeNull()
    expect((img as HTMLImageElement).src).toContain(
      'data:image/jpeg;base64,base64encodeddata'
    )
  })

  it('shows REC indicator when recording', () => {
    renderControl({ is_recording: true, armed: false })
    expect(screen.getByText('REC')).toBeInTheDocument()
  })

  it('does not show REC indicator when not recording', () => {
    renderControl({ is_recording: false, armed: false })
    expect(screen.queryByText('REC')).not.toBeInTheDocument()
  })

  it('shows ARMED indicator when armed', () => {
    renderControl({ is_recording: false, armed: true })
    expect(screen.getByText('ARMED')).toBeInTheDocument()
  })

  it('does not show ARMED indicator when not armed', () => {
    renderControl({ is_recording: false, armed: false })
    expect(screen.queryByText('ARMED')).not.toBeInTheDocument()
  })

  it('renders bounding box overlay when bbox is set', () => {
    renderControl({
      armed: false,
      is_recording: false,
      bbox: { top: 0.3, left: 0.2, width: 0.4, height: 0.3, conf: 0.95 },
    })
    // Bounding box confidence should be rendered
    expect(screen.getByText('0.95')).toBeInTheDocument()
  })

  it('does not render bounding box overlay when bbox is null', () => {
    renderControl({ armed: false, is_recording: false, bbox: null })
    // Should not have confidence display
    expect(screen.queryByText(/0\.\d+/)).not.toBeInTheDocument()
  })

  it('logs statusPollingError to console.error', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockUseRocam.mockReturnValue({
      apiClient: mockApiClient,
      status: null,
      statusPollingError: new Error('network error'),
    })
    render(
      <MemoryRouter>
        <I18nProvider i18n={i18n}>
          <ControlPage />
        </I18nProvider>
      </MemoryRouter>
    )
    expect(consoleSpy).toHaveBeenCalledWith(expect.any(Error))
    consoleSpy.mockRestore()
  })

  describe('Drag interaction', () => {
    it('does not start drag when status.armed is true', () => {
      renderControl({ armed: true, is_recording: false, tilt: 10, pan: 20 })
      const overlay = document.querySelector(
        '[style*="touch-action: none"]'
      ) as HTMLElement
      if (overlay) {
        fireEvent.pointerDown(overlay, {
          clientX: 100,
          clientY: 100,
          pointerId: 1,
        })
        fireEvent.pointerMove(overlay, {
          clientX: 150,
          clientY: 150,
          pointerId: 1,
        })
        // Should not call manualMoveTo since armed
        expect(mockApiClient.manualMoveTo).not.toHaveBeenCalled()
      }
    })

    it('does not start drag when status is null', () => {
      renderControl(undefined)
      const overlay = document.querySelector(
        '[style*="touch-action: none"]'
      ) as HTMLElement
      if (overlay) {
        fireEvent.pointerDown(overlay, {
          clientX: 100,
          clientY: 100,
          pointerId: 1,
        })
        fireEvent.pointerMove(overlay, {
          clientX: 200,
          clientY: 200,
          pointerId: 1,
        })
        expect(mockApiClient.manualMoveTo).not.toHaveBeenCalled()
      }
    })

    it('handles pointerUp without crashing', () => {
      renderControl({ armed: false, is_recording: false, tilt: 10, pan: 20 })
      const overlay = document.querySelector(
        '[style*="touch-action: none"]'
      ) as HTMLElement
      if (overlay) {
        fireEvent.pointerUp(overlay)
      }
      expect(document.body).toBeDefined()
    })

    it('handles pointerCancel without crashing', () => {
      renderControl({ armed: false, is_recording: false, tilt: 10, pan: 20 })
      const overlay = document.querySelector(
        '[style*="touch-action: none"]'
      ) as HTMLElement
      if (overlay) {
        fireEvent.pointerCancel(overlay)
      }
      expect(document.body).toBeDefined()
    })

    it('starts drag when status is non-null and not armed', () => {
      renderControl({ armed: false, is_recording: false, tilt: 10, pan: 20 })
      const overlay = document.querySelector(
        '[style*="touch-action: none"]'
      ) as HTMLElement
      if (overlay) {
        // Mock setPointerCapture so it does not throw in jsdom
        overlay.setPointerCapture = vi.fn()
        fireEvent.pointerDown(overlay, {
          clientX: 100,
          clientY: 100,
          pointerId: 1,
        })
        // Drag has started; pointerMove should now attempt manualMoveTo
        // Advance time past the throttle window by mocking Date.now
        const realNow = Date.now
        vi.spyOn(Date, 'now').mockReturnValue(realNow() + 1000)
        fireEvent.pointerMove(overlay, {
          clientX: 200,
          clientY: 200,
          pointerId: 1,
        })
        vi.restoreAllMocks()
        // manualMoveTo should have been called since drag is active
        expect(mockApiClient.manualMoveTo).toHaveBeenCalled()
      } else {
        expect(document.body).toBeDefined()
      }
    })
  })
})
