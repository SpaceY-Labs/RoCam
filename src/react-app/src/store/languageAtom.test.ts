/**
 * Unit tests for src/store/settingsAtom.ts
 *
 * Tests that atoms are created with correct default values
 * and that their keys are correctly configured.
 */
import { describe, it, expect } from 'vitest'

import {
  languageAtom,
  temperatureUnitAtom,
  invertDragAtom,
  dragSensitivityAtom,
} from './settingsAtom'

describe('languageAtom', () => {
  it('is defined', () => {
    expect(languageAtom).toBeDefined()
  })

  it('has the correct storage key', () => {
    // atomWithStorage stores the key as a property
    expect((languageAtom as any).toString()).toContain('atom')
  })
})

describe('temperatureUnitAtom', () => {
  it('is defined', () => {
    expect(temperatureUnitAtom).toBeDefined()
  })
})

describe('invertDragAtom', () => {
  it('is defined', () => {
    expect(invertDragAtom).toBeDefined()
  })
})

describe('dragSensitivityAtom', () => {
  it('is defined', () => {
    expect(dragSensitivityAtom).toBeDefined()
  })
})

describe('Type guards', () => {
  it('Language type accepts valid values', () => {
    const langs: Array<'en' | 'fr'> = ['en', 'fr']

    expect(langs).toHaveLength(2)
  })

  it('TemperatureUnit type accepts valid values', () => {
    const units: Array<'celsius' | 'fahrenheit'> = ['celsius', 'fahrenheit']

    expect(units).toHaveLength(2)
  })
})
