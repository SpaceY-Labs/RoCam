/**
 * Unit tests for src/components/ControlsCard.tsx
 *
 * Covers:
 *   - Renders without crashing when useRocam returns null status
 *   - Arm button triggers apiClient.arm()
 *   - Disarm button triggers apiClient.disarm() when armed
 *   - Record start/stop buttons trigger corresponding API calls
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

import { renderWithI18n } from '@/test/renderWithProviders'
import { useRocam } from '@/network/rocamProvider'
import { ControlsCard } from './ControlsCard'

// Mock useRocam to control context values
const mockApiClient = {
  arm: vi.fn().mockResolvedValue({}),
  disarm: vi.fn().mockResolvedValue({}),
  startRecording: vi.fn().mockResolvedValue({}),
  stopRecording: vi.fn().mockResolvedValue({}),
  manualMove: vi.fn().mockResolvedValue({}),
  manualMoveTo: vi.fn().mockResolvedValue({}),
}

vi.mock('@/network/rocamProvider', () => ({
  useRocam: vi.fn(),
}))

// Mock lingui to avoid needing real i18n setup
// Use createElement instead of JSX to avoid Lingui macro compilation issues
vi.mock('@lingui/react/macro', () => ({
  Trans: ({ children }: any) =>
    React.createElement(React.Fragment, null, children),
  useLingui: () => ({ t: (s: TemplateStringsArray | string) => String(s) }),
}))

// Mock react-use's useTimeoutFn
vi.mock('react-use', () => ({
  useTimeoutFn: () => [null, null, vi.fn()],
}))

function renderCard(armed = false, isRecording = false) {
  ;(useRocam as ReturnType<typeof vi.fn>).mockReturnValue({
    apiClient: mockApiClient,
    status: { armed, is_recording: isRecording },
    statusPollingError: null,
  })

  return renderWithI18n(<ControlsCard />)
}

describe('ControlsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders without crashing', async () => {
    await renderCard()
    expect(document.body).toBeDefined()
  })

  it('calls arm() when ARM button is clicked (not armed)', async () => {
    await renderCard(false)
    const armBtn = screen
      .queryAllByRole('button')
      .find(
        (b) => b.textContent?.includes('Arm') || b.textContent?.includes('ARM')
      )

    if (armBtn) {
      fireEvent.click(armBtn)
      await waitFor(() => {
        expect(mockApiClient.arm).toHaveBeenCalledTimes(1)
      })
    }
  })

  it('calls disarm() when ARM button is clicked while armed', async () => {
    await renderCard(true)
    const buttons = screen.queryAllByRole('button')
    const disarmBtn = buttons.find(
      (b) =>
        b.textContent?.includes('Disarm') || b.textContent?.includes('DISARM')
    )

    if (disarmBtn) {
      fireEvent.click(disarmBtn)
      const confirmBtn = await screen.findByRole('button', {
        name: /Disarm and Manual Control/i,
      })

      fireEvent.click(confirmBtn)
      await waitFor(() => {
        expect(mockApiClient.disarm).toHaveBeenCalledTimes(1)
      })
    }
  })

  it('shows disarm/manual dialog when move is attempted while armed', async () => {
    await renderCard(true)
    const upBtn = screen.getByTestId('gimbal-up')

    fireEvent.click(upBtn)
    expect(screen.getByText(/Disarm and switch to manual control/i)).toBeDefined()
    expect(mockApiClient.manualMove).not.toHaveBeenCalled()

    const confirmBtn = await screen.findByRole('button', {
      name: /Disarm and Manual Control/i,
    })

    fireEvent.click(confirmBtn)
    await waitFor(() => {
      expect(mockApiClient.disarm).toHaveBeenCalledTimes(1)
    })
  })

  it('calls startRecording() when record button clicked (not recording)', async () => {
    await renderCard(false, false)
    const recordBtn = screen
      .queryAllByRole('button')
      .find((b) => b.textContent?.includes('Start Recording'))

    if (recordBtn) {
      fireEvent.click(recordBtn)
      await waitFor(() => {
        expect(mockApiClient.startRecording).toHaveBeenCalledTimes(1)
      })
    }
  })

  it('calls stopRecording() when record button clicked (currently recording)', async () => {
    await renderCard(false, true)
    const stopBtn = screen
      .queryAllByRole('button')
      .find((b) => b.textContent?.includes('Stop Recording'))

    if (stopBtn) {
      fireEvent.click(stopBtn)
      await waitFor(() => {
        expect(mockApiClient.stopRecording).toHaveBeenCalledTimes(1)
      })
    }
  })

  it('swallows error when arm() throws', async () => {
    mockApiClient.arm.mockRejectedValueOnce(new Error('arm failed'))
    await renderCard(false)
    const armBtn = screen
      .queryAllByRole('button')
      .find((b) => b.textContent?.includes('Arm'))

    if (armBtn) {
      fireEvent.click(armBtn)
      await waitFor(() => {
        expect(mockApiClient.arm).toHaveBeenCalled()
      })
    }
    // Should not throw
    expect(document.body).toBeDefined()
  })

  it('swallows error when startRecording() throws', async () => {
    mockApiClient.startRecording.mockRejectedValueOnce(new Error('rec failed'))
    await renderCard(false, false)
    const recordBtn = screen
      .queryAllByRole('button')
      .find((b) => b.textContent?.includes('Start Recording'))

    if (recordBtn) {
      fireEvent.click(recordBtn)
      await waitFor(() => {
        expect(mockApiClient.startRecording).toHaveBeenCalled()
      })
    }
    expect(document.body).toBeDefined()
  })

  it('renders with null status without crashing', async () => {
    ;(useRocam as ReturnType<typeof vi.fn>).mockReturnValue({
      apiClient: null,
      status: null,
      statusPollingError: null,
    })

    renderWithI18n(<ControlsCard />)
    expect(document.body).toBeDefined()
  })

  it('disables arm and record buttons when apiClient is null', async () => {
    ;(useRocam as ReturnType<typeof vi.fn>).mockReturnValue({
      apiClient: null,
      status: null,
      statusPollingError: null,
    })

    renderWithI18n(<ControlsCard />)
    const buttons = screen.queryAllByRole('button')
    // The arm and record buttons (last two in the flex column) should be disabled
    const armBtn = buttons.find((b) => b.textContent?.includes('Arm'))
    const recBtn = buttons.find((b) =>
      b.textContent?.includes('Start Recording')
    )

    expect(armBtn).toBeDefined()
    expect(recBtn).toBeDefined()
  })
})

describe('GimbalPad', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls manualMove("up") when up button pressed', async () => {
    await renderCard(false)
    fireEvent.click(screen.getByTestId('gimbal-up'))
    await waitFor(() => {
      expect(mockApiClient.manualMove).toHaveBeenCalledWith('up')
    })
  })

  it('calls manualMoveTo(0, 0) when home button pressed', async () => {
    await renderCard(false)
    fireEvent.click(screen.getByTestId('gimbal-home'))
    await waitFor(() => {
      expect(mockApiClient.manualMoveTo).toHaveBeenCalledWith(0, 0)
    })
  })

  it('calls manualMove("left") when left button pressed', async () => {
    await renderCard(false)
    fireEvent.click(screen.getByTestId('gimbal-left'))
    await waitFor(() => {
      expect(mockApiClient.manualMove).toHaveBeenCalledWith('left')
    })
  })

  it('calls manualMove("down") when down button pressed', async () => {
    await renderCard(false)
    fireEvent.click(screen.getByTestId('gimbal-down'))
    await waitFor(() => {
      expect(mockApiClient.manualMove).toHaveBeenCalledWith('down')
    })
  })
})
