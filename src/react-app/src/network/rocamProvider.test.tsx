/**
 * Unit tests for src/network/rocamProvider.tsx
 *
 * Covers:
 *   - useRocam() throws when used outside RocamProvider
 *   - RocamProvider renders children
 *   - RocamProvider exposes null status initially
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import React from 'react'
import { I18nProvider } from '@lingui/react'
import { i18n } from '@lingui/core'

import { useRocam, RocamProvider } from './rocamProvider'

// Setup i18n for tests
i18n.load('en', {})
i18n.activate('en')

// Mock ApiClient.createAutomatic to avoid real network calls
vi.mock('./api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./api')>()

  return {
    ...original,
    ApiClient: class {
      static createAutomatic = vi
        .fn()
        .mockRejectedValue(new Error('no network'))
      getStatusStreamUrl = vi.fn().mockReturnValue('/api/status')
      getGenerate204Url = vi.fn().mockReturnValue('/api/generate_204')
    },
  }
})

// Stub EventSource globally
class FakeEventSource {
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  close = vi.fn()
  constructor(_url: string) {}
}

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource)
})

function ConsumerComponent() {
  const { status, apiClient } = useRocam()

  return (
    <div>
      <span data-testid="status">
        {status === null ? 'null' : 'has-status'}
      </span>
      <span data-testid="client">
        {apiClient === null ? 'null' : 'has-client'}
      </span>
    </div>
  )
}

describe('useRocam', () => {
  it('throws when used outside RocamProvider', () => {
    // Suppress console.error for this test
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => render(<ConsumerComponent />)).toThrow()
    spy.mockRestore()
  })
})

// Helper to wrap RocamProvider with I18nProvider
function renderWithProvider(ui: React.ReactElement) {
  return render(
    <I18nProvider i18n={i18n}>
      <RocamProvider>{ui}</RocamProvider>
    </I18nProvider>
  )
}

describe('RocamProvider', () => {
  it('renders children', () => {
    renderWithProvider(<span>hello</span>)
    expect(screen.getByText('hello')).toBeDefined()
  })

  it('provides null status initially', () => {
    renderWithProvider(<ConsumerComponent />)
    expect(screen.getByTestId('status').textContent).toBe('null')
  })

  it('provides null apiClient initially', () => {
    renderWithProvider(<ConsumerComponent />)
    expect(screen.getByTestId('client').textContent).toBe('null')
  })

  it('sets apiClient when ApiClient.createAutomatic resolves', async () => {
    const { ApiClient } = await import('./api')
    const fakeClient = {
      getStatusStreamUrl: vi.fn().mockReturnValue('/api/status'),
      getGenerate204Url: vi.fn().mockReturnValue('/api/generate_204'),
      getLogsStreamUrl: vi.fn().mockReturnValue('/api/logs'),
    }

    vi.mocked(ApiClient.createAutomatic).mockResolvedValueOnce(
      fakeClient as unknown as InstanceType<typeof ApiClient>
    )

    renderWithProvider(<ConsumerComponent />)
    await waitFor(() => {
      expect(screen.getByTestId('client').textContent).toBe('has-client')
    })
  })

  it('updates status when SSE onmessage fires', async () => {
    const { ApiClient } = await import('./api')
    let statusEs: FakeEventSource | null = null
    const fakeClient = {
      getStatusStreamUrl: vi.fn().mockReturnValue('/api/status'),
      getLogsStreamUrl: vi.fn().mockReturnValue('/api/logs'),
    }

    vi.mocked(ApiClient.createAutomatic).mockResolvedValueOnce(
      fakeClient as unknown as InstanceType<typeof ApiClient>
    )

    vi.stubGlobal(
      'EventSource',
      class extends FakeEventSource {
        constructor(url: string) {
          super(url)
          // Capture the status EventSource specifically
          if (url === '/api/status') {
            statusEs = this
          }
        }
      }
    )

    renderWithProvider(<ConsumerComponent />)

    // Wait for apiClient to be set
    await waitFor(() => {
      expect(screen.getByTestId('client').textContent).toBe('has-client')
    })

    // Simulate SSE message on the status stream
    act(() => {
      if (statusEs?.onmessage) {
        statusEs.onmessage(
          new MessageEvent('message', {
            data: JSON.stringify({ armed: false, recording: false }),
          })
        )
      }
    })

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('has-status')
    })
  })

  it('closes EventSource when component unmounts', async () => {
    const { ApiClient } = await import('./api')
    let statusEs: FakeEventSource | null = null
    const fakeClient = {
      getStatusStreamUrl: vi.fn().mockReturnValue('/api/status'),
      getLogsStreamUrl: vi.fn().mockReturnValue('/api/logs'),
    }

    vi.mocked(ApiClient.createAutomatic).mockResolvedValueOnce(
      fakeClient as unknown as InstanceType<typeof ApiClient>
    )

    vi.stubGlobal(
      'EventSource',
      class extends FakeEventSource {
        constructor(url: string) {
          super(url)
          if (url === '/api/status') {
            statusEs = this
          }
        }
      }
    )

    const { unmount } = renderWithProvider(<ConsumerComponent />)

    await waitFor(() => {
      expect(screen.getByTestId('client').textContent).toBe('has-client')
    })

    unmount()
    expect(statusEs?.close).toHaveBeenCalledOnce()
  })

  it('ignores malformed SSE messages gracefully', async () => {
    const { ApiClient } = await import('./api')
    let statusEs: FakeEventSource | null = null
    const fakeClient = {
      getStatusStreamUrl: vi.fn().mockReturnValue('/api/status'),
      getLogsStreamUrl: vi.fn().mockReturnValue('/api/logs'),
    }

    vi.mocked(ApiClient.createAutomatic).mockResolvedValueOnce(
      fakeClient as unknown as InstanceType<typeof ApiClient>
    )

    vi.stubGlobal(
      'EventSource',
      class extends FakeEventSource {
        constructor(url: string) {
          super(url)
          if (url === '/api/status') {
            statusEs = this
          }
        }
      }
    )

    renderWithProvider(<ConsumerComponent />)

    await waitFor(() => {
      expect(screen.getByTestId('client').textContent).toBe('has-client')
    })

    // Simulate malformed SSE message on the status stream
    act(() => {
      if (statusEs?.onmessage) {
        statusEs.onmessage(new MessageEvent('message', { data: 'not-json{{{' }))
      }
    })

    // Status should remain null (no crash, no status update)
    expect(screen.getByTestId('status').textContent).toBe('null')
  })
})
