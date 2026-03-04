import { atomWithStorage } from 'jotai/utils'

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
