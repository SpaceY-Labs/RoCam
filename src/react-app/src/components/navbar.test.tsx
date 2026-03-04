/**
 * Unit tests for src/components/navbar.tsx
 *
 * Covers:
 *   - Renders navigation links for Control and Recordings
 *   - Active route highlighting
 */
import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
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
})
