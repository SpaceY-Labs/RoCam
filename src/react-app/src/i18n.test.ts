/**
 * Unit tests for src/i18n.ts
 *
 * Covers dynamicActivate() - mocks the dynamic import and verifies
 * that i18n.load() and i18n.activate() are called with the correct locale.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock @lingui/core before importing our module
vi.mock('@lingui/core', () => ({
  i18n: {
    load: vi.fn(),
    activate: vi.fn(),
  },
}))

describe('dynamicActivate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads and activates the given locale', async () => {
    // Mock the dynamic import for the locale messages
    vi.doMock('./locales/en/messages.mjs', () => ({
      messages: { hello: 'Hello' },
    }))

    const { i18n } = await import('@lingui/core')
    const { dynamicActivate } = await import('./i18n')

    // Use a fake locale to avoid real file I/O
    vi.doMock('./locales/fr/messages.mjs', () => ({
      messages: { hello: 'Bonjour' },
    }))

    await dynamicActivate('fr')

    expect(i18n.load).toHaveBeenCalledWith('fr', expect.any(Object))
    expect(i18n.activate).toHaveBeenCalledWith('fr')
  })

  it('calls load before activate', async () => {
    const { i18n } = await import('@lingui/core')
    const callOrder: string[] = []

    ;(i18n.load as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callOrder.push('load')
    })
    ;(i18n.activate as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callOrder.push('activate')
    })

    vi.doMock('./locales/en/messages.mjs', () => ({
      messages: {},
    }))

    const { dynamicActivate } = await import('./i18n')

    await dynamicActivate('en')

    expect(callOrder[0]).toBe('load')
    expect(callOrder[1]).toBe('activate')
  })
})
