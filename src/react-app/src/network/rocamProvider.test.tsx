/**
 * Unit tests for src/network/rocamProvider.tsx
 *
 * Covers:
 *   - useRocam() throws when used outside RocamProvider
 *   - RocamProvider renders children
 *   - RocamProvider exposes null status initially
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { useRocam, RocamProvider } from './rocamProvider'

// Mock ApiClient.createAutomatic to avoid real network calls
vi.mock('./api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./api')>()

  return {
    ...original,
    ApiClient: class {
      static createAutomatic = vi.fn().mockRejectedValue(new Error('no network'))
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
      <span data-testid="status">{status === null ? 'null' : 'has-status'}</span>
      <span data-testid="client">{apiClient === null ? 'null' : 'has-client'}</span>
      <span data-testid="error">{statusPollingError === null ? 'null' : 'has-error'}</span>
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
})
