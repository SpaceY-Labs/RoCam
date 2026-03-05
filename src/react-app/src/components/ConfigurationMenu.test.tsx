/**
 * Unit tests for ConfigurationMenu component
 *
 * Covers: language switching, temperature unit switching, invert-drag toggle,
 * and drag sensitivity slider interaction.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { i18n } from '@lingui/core'

i18n.load('en', {})
i18n.activate('en')

// Atom mock state
const mockSetLanguage = vi.fn()
const mockSetTemperatureUnit = vi.fn()
const mockSetInvertDrag = vi.fn()
const mockSetDragSensitivity = vi.fn()
const mockSetShowLogs = vi.fn()

let mockLanguage = 'en'
let mockTemperatureUnit = 'celsius'
let mockInvertDrag = false
let mockDragSensitivity = 0.15
let mockShowLogs = false

// Mock the settingsAtom module directly
vi.mock('@/store/settingsAtom', () => ({
  languageAtom: { toString: () => 'languageAtom' },
  temperatureUnitAtom: { toString: () => 'temperatureUnitAtom' },
  invertDragAtom: { toString: () => 'invertDragAtom' },
  dragSensitivityAtom: { toString: () => 'dragSensitivityAtom' },
  showLogsAtom: { toString: () => 'showLogsAtom' },
}))

// Mock jotai's useAtom to return appropriate mock values
vi.mock('jotai', async () => {
  const actual = await vi.importActual('jotai')

  return {
    ...actual,
    useAtom: vi.fn((atom: { toString?: () => string }) => {
      const atomId = atom.toString?.() || ''

      if (atomId.includes('languageAtom'))
        return [mockLanguage, mockSetLanguage]
      if (atomId.includes('temperatureUnitAtom'))
        return [mockTemperatureUnit, mockSetTemperatureUnit]
      if (atomId.includes('invertDragAtom'))
        return [mockInvertDrag, mockSetInvertDrag]
      if (atomId.includes('dragSensitivityAtom'))
        return [mockDragSensitivity, mockSetDragSensitivity]
      if (atomId.includes('showLogsAtom'))
        return [mockShowLogs, mockSetShowLogs]

      return [null, vi.fn()]
    }),
    useAtomValue: vi.fn((atom: { toString?: () => string }) => {
      const atomId = atom.toString?.() || ''

      if (atomId.includes('languageAtom')) return mockLanguage
      if (atomId.includes('temperatureUnitAtom')) return mockTemperatureUnit
      if (atomId.includes('invertDragAtom')) return mockInvertDrag
      if (atomId.includes('dragSensitivityAtom')) return mockDragSensitivity
      if (atomId.includes('showLogsAtom')) return mockShowLogs

      return null
    }),
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
    'aria-label': ariaLabel,
  }: {
    onChange?: (v: number | number[]) => void
    value?: number
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
    mockShowLogs = false
    onActionHandler = undefined
    onSliderChange = undefined
    mockSetLanguage.mockReset()
    mockSetTemperatureUnit.mockReset()
    mockSetInvertDrag.mockReset()
    mockSetDragSensitivity.mockReset()
    mockSetShowLogs.mockReset()
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
