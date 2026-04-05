/**
 * Author: Zifan Si
 * Date: 2026-04-05
 * Purpose: Stores persisted user preferences shared across the frontend.
 */
import { atomWithStorage } from 'jotai/utils'

/** Persisted user preferences shared across the frontend experience. */
export type Language = 'en' | 'fr'
export type TemperatureUnit = 'celsius' | 'fahrenheit'

export const languageAtom = atomWithStorage<Language>('app-language', 'en')

// Unit preference atoms
export const temperatureUnitAtom = atomWithStorage<TemperatureUnit>(
  'app-temperature-unit',
  'celsius'
)

// Camera drag control preferences
export const invertDragAtom = atomWithStorage<boolean>('app-invert-drag', false)
export const dragSensitivityAtom = atomWithStorage<number>(
  'app-drag-sensitivity',
  0.15
)

// Developer mode preference
export const showLogsAtom = atomWithStorage<boolean>(
  'app-developer-show-logs',
  false
)
