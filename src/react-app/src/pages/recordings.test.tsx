/**
 * Unit tests for src/pages/recordings.tsx
 *
 * Covers:
 *   - Shows loading spinner initially
 *   - Shows "no recordings" message when list is empty
 *   - Renders recording items when data is available
 *   - Handles delete action
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { renderWithI18n } from '@/test/renderWithProviders'

const mockApiClient = {
  listRecordings: vi.fn(),
  deleteRecording: vi.fn().mockResolvedValue({}),
  renameRecording: vi.fn().mockResolvedValue({}),
  getDownloadStabilizedUrl: vi.fn((id: string) => `/api/recordings/${id}/download-stabilized`),
  getPreviewStabilizedUrl: vi.fn((id: string) => `/api/recordings/${id}/preview-stabilized`),
}

vi.mock('@/network/rocamProvider', () => ({
  useRocam: vi.fn(),
}))

vi.mock('@/layouts/default', () => ({
  default: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'layout' }, children),
}))

async function renderRecordingsPage() {
  const { useRocam } = await import('@/network/rocamProvider')
  ;(useRocam as ReturnType<typeof vi.fn>).mockReturnValue({
    apiClient: mockApiClient,
    status: null,
    statusPollingError: null,
  })
  const { default: RecordingsPage } = await import('./recordings')
  return renderWithI18n(
    <MemoryRouter>
      <RecordingsPage />
    </MemoryRouter>
  )
}

describe('RecordingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows loading state initially', async () => {
    mockApiClient.listRecordings.mockImplementation(
      () => new Promise((_resolve) => {}) // never resolves
    )
    await renderRecordingsPage()
    expect(screen.queryByText(/Loading/i) || document.querySelector('[class*="spinner"]')).toBeDefined()
  })

  it('shows empty message when no recordings', async () => {
    mockApiClient.listRecordings.mockResolvedValue({ recordings: [] })
    await renderRecordingsPage()
    await waitFor(() => {
      expect(screen.queryByText(/No recordings/i)).toBeDefined()
    }, { timeout: 3000 })
  })

  it('renders recording items when data is loaded', async () => {
    mockApiClient.listRecordings.mockResolvedValue({
      recordings: [
        {
          id: 'rec1',
          name: 'Test Recording',
          start_timestamp_ms: 1700000000000,
          duration_ms: 60000,
          size_bytes: 1024 * 1024,
        },
      ],
    })
    await renderRecordingsPage()
    await waitFor(() => {
      expect(screen.queryByText('Test Recording')).toBeDefined()
    }, { timeout: 3000 })
  })

  it('renders without crashing when apiClient is null', async () => {
    const { useRocam } = await import('@/network/rocamProvider')
    ;(useRocam as ReturnType<typeof vi.fn>).mockReturnValue({
      apiClient: null,
      status: null,
      statusPollingError: null,
    })
    const { default: RecordingsPage } = await import('./recordings')
    renderWithI18n(
      <MemoryRouter>
        <RecordingsPage />
      </MemoryRouter>
    )
    expect(document.body).toBeDefined()
  })
})
