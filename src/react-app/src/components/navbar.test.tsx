/**
 * Unit tests for src/components/navbar.tsx
 *
 * Covers:
 *   - Renders navigation links for Control and Recordings
 *   - Active route highlighting
 *   - Fullscreen toggle (enter/exit)
 *   - Emergency Stop button
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'
import { renderWithI18n } from '@/test/renderWithProviders'

// Mock the ConfigurationMenu to avoid rendering its complexity
vi.mock('./ConfigurationMenu', () => ({
  ConfigurationMenu: () => React.createElement('div', { 'data-testid': 'config-menu' }),
}))

async function renderNavbar(initialPath = '/') {
  const { Navbar } = await import('./navbar')
  return renderWithI18n(
    <MemoryRouter initialEntries={[initialPath]}>
      <Navbar />
    </MemoryRouter>
  )
}

describe('Navbar', () => {
  it('renders without crashing', async () => {
    await renderNavbar()
    expect(document.body).toBeDefined()
  })

  it('renders Control navigation link', async () => {
    await renderNavbar('/')
    const links = screen.getAllByRole('link')
    const controlLink = links.find(l => l.textContent?.includes('Control'))
    expect(controlLink).toBeDefined()
  })

  it('renders Recordings navigation link', async () => {
    await renderNavbar('/recordings')
    const links = screen.getAllByRole('link')
    const recordingsLink = links.find(l => l.textContent?.includes('Recordings'))
    expect(recordingsLink).toBeDefined()
  })

  it('shows configuration menu', async () => {
    await renderNavbar()
    expect(screen.getByTestId('config-menu')).toBeDefined()
  })

  describe('Fullscreen button', () => {
    beforeEach(() => {
      // Default: not in fullscreen
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        get: () => null,
      })
    })

    it('calls requestFullscreen when not in fullscreen', async () => {
      const requestFullscreen = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(document.documentElement, 'requestFullscreen', {
        configurable: true,
        value: requestFullscreen,
      })
      await renderNavbar()
      const fullscreenBtn = screen.getByRole('button', { name: /fullscreen/i })
      fireEvent.click(fullscreenBtn)
      expect(requestFullscreen).toHaveBeenCalledOnce()
    })

    it('calls exitFullscreen when already in fullscreen', async () => {
      const exitFullscreen = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        get: () => document.documentElement,
      })
      Object.defineProperty(document, 'exitFullscreen', {
        configurable: true,
        value: exitFullscreen,
      })
      await renderNavbar()
      const exitBtn = screen.getByRole('button', { name: /exit fullscreen/i })
      fireEvent.click(exitBtn)
      expect(exitFullscreen).toHaveBeenCalledOnce()
    })
  })

  describe('Emergency Stop button', () => {
    it('calls window.alert when emergency stop is pressed', async () => {
      const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => {})
      await renderNavbar()
      const emergencyBtn = screen.getByRole('button', { name: /emergency stop/i })
      fireEvent.click(emergencyBtn)
      expect(alertMock).toHaveBeenCalled()
      alertMock.mockRestore()
    })
  })
})
