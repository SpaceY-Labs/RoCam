import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

export type Language = 'en' | 'fr'
export type TemperatureUnit = 'celsius' | 'fahrenheit'
export type PowerUnit = 'watts' | 'kilowatts'

export const languageAtom = atomWithStorage<Language>('app-language', 'en')
export const metricsModalOpenAtom = atom<boolean>(false)

// Unit preference atoms
export const temperatureUnitAtom = atomWithStorage<TemperatureUnit>(
  'app-temperature-unit',
  'celsius'
)
export const powerUnitAtom = atomWithStorage<PowerUnit>(
  'app-power-unit',
  'watts'
)
