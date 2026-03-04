/**
 * Unit tests for ConfigurationMenu component
 *
 * Covers: language switching, temperature unit switching, invert-drag toggle,
 * and drag sensitivity slider interaction.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { i18n } from '@lingui/core'

i18n.load('en', {})
i18n.activate('en')

// Atom mock state
const mockSetLanguage = vi.fn()
const mockSetTemperatureUnit = vi.fn()
const mockSetInvertDrag = vi.fn()
const mockSetDragSensitivity = vi.fn()

let mockLanguage = 'en'
let mockTemperatureUnit = 'celsius'
let mockInvertDrag = false
let mockDragSensitivity = 0.15

vi.mock('jotai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jotai')>()
  return {
    ...actual,
    useAtom: vi.fn((atom: unknown) => {
      // Return appropriate state based on which atom is being accessed
      // We identify atoms by the order they are called inside the component
      const call =
        (vi.mocked(actual.useAtom) as ReturnType<typeof vi.fn>).mock.calls
          .length ?? 0
      // Since we can't easily identify atoms by reference, use a call-count approach
      return [mockLanguage, mockSetLanguage]
    }),
  }
})

// We need a smarter mock for multiple useAtom calls
// Reset and use a sequential approach
vi.mock('jotai', async () => {
  let callIndex = 0
  const atomResults = [
    () => [mockLanguage, mockSetLanguage],
    () => [mockTemperatureUnit, mockSetTemperatureUnit],
    () => [mockInvertDrag, mockSetInvertDrag],
    () => [mockDragSensitivity, mockSetDragSensitivity],
  ]
  return {
    useAtom: vi.fn(() => {
      const result = atomResults[callIndex % atomResults.length]()
      callIndex++
      return result
    }),
    useAtomValue: vi.fn(() => 'en'),
    // Jotai Provider noop
    Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  }
})

let onActionHandler: ((key: React.Key) => void) | undefined
let onSliderChange: ((v: number | number[]) => void) | undefined

vi.mock('@heroui/dropdown', () => ({
  Dropdown: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown">{children}</div>
  ),
  DropdownTrigger: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenu: ({
    children,
    onAction,
  }: {
    children: React.ReactNode
    onAction?: (key: React.Key) => void
  }) => {
    onActionHandler = onAction
    return <ul data-testid="dropdown-menu">{children}</ul>
  },
  DropdownItem: ({
    children,
    textValue,
  }: {
    children: React.ReactNode
    textValue?: string
  }) => <li>{children ?? textValue}</li>,
  DropdownSection: ({
    children,
    title,
  }: {
    children: React.ReactNode
    title?: string
  }) => (
    <li>
      <span data-testid={`section-${title}`}>{title}</span>
      <ul>{children}</ul>
    </li>
  ),
}))

vi.mock('@heroui/button', () => ({
  Button: ({ children, ...props }: { children: React.ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}))

vi.mock('@heroui/slider', () => ({
  Slider: ({
    onChange,
    value,
    label,
    'aria-label': ariaLabel,
  }: {
    onChange?: (v: number | number[]) => void
    value?: number
    label?: React.ReactNode
    'aria-label'?: string
  }) => {
    onSliderChange = onChange
    return (
      <input
        aria-label={ariaLabel}
        data-testid="drag-slider"
        type="range"
        value={value}
        onChange={(e) => onChange?.(parseFloat(e.target.value))}
      />
    )
  },
}))

vi.mock('@tabler/icons-react', () => ({
  IconSettings: () => <span>⚙</span>,
}))

import { ConfigurationMenu } from './ConfigurationMenu'

const renderMenu = () =>
  render(
    <I18nProvider i18n={i18n}>
      <ConfigurationMenu />
    </I18nProvider>
  )

describe('ConfigurationMenu', () => {
  beforeEach(() => {
    mockLanguage = 'en'
    mockTemperatureUnit = 'celsius'
    mockInvertDrag = false
    mockDragSensitivity = 0.15
    onActionHandler = undefined
    onSliderChange = undefined
    mockSetLanguage.mockReset()
    mockSetTemperatureUnit.mockReset()
    mockSetInvertDrag.mockReset()
    mockSetDragSensitivity.mockReset()
  })

  it('renders the configuration button', () => {
    renderMenu()
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('renders the dropdown menu', () => {
    renderMenu()
    expect(screen.getByTestId('dropdown-menu')).toBeInTheDocument()
  })

  it('calls setLanguage("fr") when fr action fires', () => {
    renderMenu()
    onActionHandler?.('fr')
    expect(mockSetLanguage).toHaveBeenCalledWith('fr')
  })

  it('calls setLanguage("en") when en action fires', () => {
    renderMenu()
    onActionHandler?.('en')
    expect(mockSetLanguage).toHaveBeenCalledWith('en')
  })

  it('calls setTemperatureUnit("fahrenheit") when fahrenheit action fires', () => {
    renderMenu()
    onActionHandler?.('fahrenheit')
    expect(mockSetTemperatureUnit).toHaveBeenCalledWith('fahrenheit')
  })

  it('calls setTemperatureUnit("celsius") when celsius action fires', () => {
    renderMenu()
    onActionHandler?.('celsius')
    expect(mockSetTemperatureUnit).toHaveBeenCalledWith('celsius')
  })

  it('toggles invertDrag when invert-drag action fires', () => {
    renderMenu()
    onActionHandler?.('invert-drag')
    expect(mockSetInvertDrag).toHaveBeenCalledWith(true) // !false
  })

  it('toggles invertDrag to false when already true', () => {
    mockInvertDrag = true
    renderMenu()
    onActionHandler?.('invert-drag')
    expect(mockSetInvertDrag).toHaveBeenCalledWith(false) // !true
  })

  it('does not call any setter for unknown action keys', () => {
    renderMenu()
    onActionHandler?.('unknown-key')
    expect(mockSetLanguage).not.toHaveBeenCalled()
    expect(mockSetTemperatureUnit).not.toHaveBeenCalled()
    expect(mockSetInvertDrag).not.toHaveBeenCalled()
  })

  it('renders the drag sensitivity slider', () => {
    renderMenu()
    expect(screen.getByTestId('drag-slider')).toBeInTheDocument()
  })

  it('calls setDragSensitivity when slider changes', () => {
    renderMenu()
    onSliderChange?.(0.1)
    expect(mockSetDragSensitivity).toHaveBeenCalledWith(0.1)
  })
})
