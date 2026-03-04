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
import { useRocam, RocamProvider } from './rocamProvider'

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
  const { status, apiClient, statusPollingError } = useRocam()
  return (
    <div>
      <span data-testid="status">
        {status === null ? 'null' : 'has-status'}
      </span>
      <span data-testid="client">
        {apiClient === null ? 'null' : 'has-client'}
      </span>
      <span data-testid="error">
        {statusPollingError === null ? 'null' : 'has-error'}
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

describe('RocamProvider', () => {
  it('renders children', () => {
    render(
      <RocamProvider>
        <span>hello</span>
      </RocamProvider>
    )
    expect(screen.getByText('hello')).toBeDefined()
  })

  it('provides null status initially', () => {
    render(
      <RocamProvider>
        <ConsumerComponent />
      </RocamProvider>
    )
    expect(screen.getByTestId('status').textContent).toBe('null')
  })

  it('provides null apiClient initially', () => {
    render(
      <RocamProvider>
        <ConsumerComponent />
      </RocamProvider>
    )
    expect(screen.getByTestId('client').textContent).toBe('null')
  })

  it('sets error when ApiClient.createAutomatic rejects', async () => {
    // Already mocked to reject with 'no network'
    render(
      <RocamProvider>
        <ConsumerComponent />
      </RocamProvider>
    )
    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toBe('has-error')
    })
  })

  it('sets apiClient when ApiClient.createAutomatic resolves', async () => {
    const { ApiClient } = await import('./api')
    const fakeClient = {
      getStatusStreamUrl: vi.fn().mockReturnValue('/api/status'),
      getGenerate204Url: vi.fn().mockReturnValue('/api/generate_204'),
    }
    vi.mocked(ApiClient.createAutomatic).mockResolvedValueOnce(
      fakeClient as unknown as InstanceType<typeof ApiClient>
    )

    render(
      <RocamProvider>
        <ConsumerComponent />
      </RocamProvider>
    )
    await waitFor(() => {
      expect(screen.getByTestId('client').textContent).toBe('has-client')
    })
  })

  it('updates status when SSE onmessage fires', async () => {
    const { ApiClient } = await import('./api')
    let capturedEs: FakeEventSource | null = null
    const fakeClient = {
      getStatusStreamUrl: vi.fn().mockReturnValue('/api/status'),
    }
    vi.mocked(ApiClient.createAutomatic).mockResolvedValueOnce(
      fakeClient as unknown as InstanceType<typeof ApiClient>
    )

    vi.stubGlobal(
      'EventSource',
      class extends FakeEventSource {
        constructor(url: string) {
          super(url)
          capturedEs = this
        }
      }
    )

    render(
      <RocamProvider>
        <ConsumerComponent />
      </RocamProvider>
    )

    // Wait for apiClient to be set
    await waitFor(() => {
      expect(screen.getByTestId('client').textContent).toBe('has-client')
    })

    // Simulate SSE message
    act(() => {
      if (capturedEs?.onmessage) {
        capturedEs.onmessage(
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

  it('sets error when SSE onerror fires', async () => {
    const { ApiClient } = await import('./api')
    let capturedEs: FakeEventSource | null = null
    const fakeClient = {
      getStatusStreamUrl: vi.fn().mockReturnValue('/api/status'),
    }
    vi.mocked(ApiClient.createAutomatic).mockResolvedValueOnce(
      fakeClient as unknown as InstanceType<typeof ApiClient>
    )

    vi.stubGlobal(
      'EventSource',
      class extends FakeEventSource {
        constructor(url: string) {
          super(url)
          capturedEs = this
        }
      }
    )

    render(
      <RocamProvider>
        <ConsumerComponent />
      </RocamProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('client').textContent).toBe('has-client')
    })

    // Simulate SSE error
    act(() => {
      if (capturedEs?.onerror) {
        capturedEs.onerror(new Event('error'))
      }
    })

    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toBe('has-error')
    })
  })

  it('closes EventSource when component unmounts', async () => {
    const { ApiClient } = await import('./api')
    let capturedEs: FakeEventSource | null = null
    const fakeClient = {
      getStatusStreamUrl: vi.fn().mockReturnValue('/api/status'),
    }
    vi.mocked(ApiClient.createAutomatic).mockResolvedValueOnce(
      fakeClient as unknown as InstanceType<typeof ApiClient>
    )

    vi.stubGlobal(
      'EventSource',
      class extends FakeEventSource {
        constructor(url: string) {
          super(url)
          capturedEs = this
        }
      }
    )

    const { unmount } = render(
      <RocamProvider>
        <ConsumerComponent />
      </RocamProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('client').textContent).toBe('has-client')
    })

    unmount()
    expect(capturedEs?.close).toHaveBeenCalledOnce()
  })

  it('ignores malformed SSE messages gracefully', async () => {
    const { ApiClient } = await import('./api')
    let capturedEs: FakeEventSource | null = null
    const fakeClient = {
      getStatusStreamUrl: vi.fn().mockReturnValue('/api/status'),
    }
    vi.mocked(ApiClient.createAutomatic).mockResolvedValueOnce(
      fakeClient as unknown as InstanceType<typeof ApiClient>
    )

    vi.stubGlobal(
      'EventSource',
      class extends FakeEventSource {
        constructor(url: string) {
          super(url)
          capturedEs = this
        }
      }
    )

    render(
      <RocamProvider>
        <ConsumerComponent />
      </RocamProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('client').textContent).toBe('has-client')
    })

    // Simulate malformed SSE message
    act(() => {
      if (capturedEs?.onmessage) {
        capturedEs.onmessage(
          new MessageEvent('message', { data: 'not-json{{{' })
        )
      }
    })

    // Status should remain null (no crash, no status update)
    expect(screen.getByTestId('status').textContent).toBe('null')
  })
})
