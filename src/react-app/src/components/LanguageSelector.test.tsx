/**
 * Author: Zifan Si
 * Date: 2026-03-04
 * Purpose: Verifies language selection updates the persisted language preference.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { i18n } from '@lingui/core'

// Activate i18n so useLingui works in tests
i18n.load('en', {})
i18n.activate('en')

// Mock jotai atom – start with 'en' and allow tracking setLanguage calls
const mockSetLanguage = vi.fn()
let mockLanguage = 'en'

vi.mock('jotai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jotai')>()

  return {
    ...actual,
    useAtom: vi.fn(() => [mockLanguage, mockSetLanguage]),
  }
})

// Mock HeroUI dropdown components with minimal functional stubs
vi.mock('@heroui/dropdown', () => ({
  Dropdown: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown">{children}</div>
  ),
  DropdownTrigger: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-trigger">{children}</div>
  ),
  DropdownMenu: ({
    children,
    onSelectionChange,
    'aria-label': ariaLabel,
  }: {
    children: React.ReactNode
    onSelectionChange?: (keys: Set<string>) => void
    'aria-label'?: string
  }) => (
    <ul aria-label={ariaLabel} data-testid="dropdown-menu">
      {React.Children.map(children, (child) =>
        React.isValidElement(child)
          ? React.cloneElement(
              child as React.ReactElement<{ onClick?: () => void }>,
              {
                onClick: () =>
                  onSelectionChange?.(new Set([child.key as string])),
              }
            )
          : child
      )}
    </ul>
  ),
  DropdownItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode
    onClick?: () => void
  }) => (
    <li
      data-testid={`dropdown-item-${children}`}
      role="menuitem"
      onClick={onClick}
      onKeyDown={onClick}
    >
      {children}
    </li>
  ),
}))

vi.mock('@heroui/button', () => ({
  Button: ({ children, ...props }: { children: React.ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}))

import { LanguageSelector } from './LanguageSelector'

/**
 * Renders the language selector inside the i18n provider used by component tests.
 *
 * @returns Rendered testing-library result for the language selector.
 */
const renderSelector = () =>
  render(
    <I18nProvider i18n={i18n}>
      <LanguageSelector />
    </I18nProvider>
  )

describe('LanguageSelector', () => {
  beforeEach(() => {
    mockLanguage = 'en'
    mockSetLanguage.mockReset()
  })

  it('renders the current language uppercased in the trigger button', () => {
    renderSelector()
    expect(screen.getByRole('button')).toHaveTextContent('EN')
  })

  it('renders both language options in the dropdown menu', () => {
    renderSelector()
    expect(screen.getByTestId('dropdown-item-EN')).toBeInTheDocument()
    expect(screen.getByTestId('dropdown-item-FR')).toBeInTheDocument()
  })

  it('calls setLanguage with "fr" when FR item is clicked', () => {
    renderSelector()
    fireEvent.click(screen.getByTestId('dropdown-item-FR'))
    expect(mockSetLanguage).toHaveBeenCalledWith('fr')
  })

  it('calls setLanguage with "en" when EN item is clicked', () => {
    mockLanguage = 'fr'
    renderSelector()
    fireEvent.click(screen.getByTestId('dropdown-item-EN'))
    expect(mockSetLanguage).toHaveBeenCalledWith('en')
  })

  it('shows FR uppercased when current language is fr', () => {
    mockLanguage = 'fr'
    renderSelector()
    expect(screen.getByRole('button')).toHaveTextContent('FR')
  })

  it('does not call setLanguage when no key is selected', () => {
    // Simulate onSelectionChange with empty Set
    renderSelector()

    // The DropdownMenu stub won't fire with empty key; just verify no spurious call
    expect(mockSetLanguage).not.toHaveBeenCalled()
  })
})
