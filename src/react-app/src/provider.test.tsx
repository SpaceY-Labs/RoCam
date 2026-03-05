import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Mock dynamicActivate to resolve immediately
const mockDynamicActivate = vi.fn().mockResolvedValue(undefined)

vi.mock('./i18n', () => ({
  dynamicActivate: (...args: unknown[]) => mockDynamicActivate(...args),
}))

// Mock RocamProvider to be transparent
vi.mock('./network/rocamProvider', () => ({
  RocamProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rocam-provider">{children}</div>
  ),
}))

// Mock HeroUIProvider
vi.mock('@heroui/system', () => ({
  HeroUIProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="heroui-provider">{children}</div>
  ),
}))

// Mock @lingui/react I18nProvider to just render children
vi.mock('@lingui/react', () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="i18n-provider">{children}</div>
  ),
}))

// Mock jotai to avoid localStorage/AggregateError issues from atomWithStorage
vi.mock('jotai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jotai')>()

  return {
    ...actual,
    // Noop Provider that just renders children
    Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useAtomValue: vi.fn(() => 'en'),
    useAtom: vi.fn(() => ['en', vi.fn()]),
  }
})

import { Provider } from './provider'

const renderProvider = (children?: React.ReactNode) =>
  render(
    <MemoryRouter>
      <Provider>{children ?? <span data-testid="child">hello</span>}</Provider>
    </MemoryRouter>
  )

describe('Provider', () => {
  beforeEach(() => {
    mockDynamicActivate.mockResolvedValue(undefined)
  })

  it('renders children after i18n is loaded', async () => {
    renderProvider()
    await waitFor(() => {
      expect(screen.getByTestId('child')).toBeInTheDocument()
    })
  })

  it('calls dynamicActivate with the default language on mount', async () => {
    renderProvider()
    await waitFor(() => {
      expect(mockDynamicActivate).toHaveBeenCalledWith('en')
    })
  })

  it('renders RocamProvider', async () => {
    renderProvider()
    await waitFor(() => {
      expect(screen.getByTestId('rocam-provider')).toBeInTheDocument()
    })
  })

  it('renders HeroUIProvider', async () => {
    renderProvider()
    await waitFor(() => {
      expect(screen.getByTestId('heroui-provider')).toBeInTheDocument()
    })
  })

  it('renders I18nProvider wrapper', async () => {
    renderProvider()
    await waitFor(() => {
      expect(screen.getByTestId('i18n-provider')).toBeInTheDocument()
    })
  })

  it('returns null while i18n is loading (before promise resolves)', async () => {
    let resolveActivate!: () => void

    mockDynamicActivate.mockReturnValue(
      new Promise<void>((r) => {
        resolveActivate = r
      })
    )
    renderProvider()
    // Child should NOT be visible yet (I18nLoader returns null before ready)
    expect(screen.queryByTestId('child')).not.toBeInTheDocument()
    // Resolve to clean up effects
    await act(async () => {
      resolveActivate()
    })
  })
})
