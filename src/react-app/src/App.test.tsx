/**
 * Unit tests for src/App.tsx
 *
 * Covers routing: each path renders the correct page (mocked).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

// Mock heavy pages to isolate routing logic
vi.mock('@/pages/control', () => ({
  default: () => <div data-testid="control-page">ControlPage</div>,
}))
vi.mock('@/pages/recordings', () => ({
  default: () => <div data-testid="recordings-page">RecordingsPage</div>,
}))

// Lazy import App after mocks are set
async function renderApp(initialPath = '/') {
  const { default: App } = await import('./App')

  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
    </MemoryRouter>
  )
}

describe('App routing', () => {
  it('renders ControlPage at /', async () => {
    await renderApp('/')
    expect(screen.getByTestId('control-page')).toBeDefined()
  })

  it('renders RecordingsPage at /recordings', async () => {
    await renderApp('/recordings')
    expect(screen.getByTestId('recordings-page')).toBeDefined()
  })

  it('redirects unknown paths to /', async () => {
    await renderApp('/unknown-path')
    // Should redirect to control page
    expect(screen.getByTestId('control-page')).toBeDefined()
  })
})
