import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

export type Language = 'en' | 'fr'
export type TemperatureUnit = 'celsius' | 'fahrenheit'
export type SpeedUnit = 'kmh' | 'mph' | 'ms'
export type DistanceUnit = 'meters' | 'kilometers' | 'feet' | 'miles'
export type TimeUnit = 'seconds' | 'minutes' | 'hours'

export const languageAtom = atomWithStorage<Language>('app-language', 'en')
export const metricsModalOpenAtom = atom<boolean>(false)

// Unit preference atoms
export const temperatureUnitAtom = atomWithStorage<TemperatureUnit>(
  'app-temperature-unit',
  'celsius'
)
export const speedUnitAtom = atomWithStorage<SpeedUnit>('app-speed-unit', 'kmh')
export const distanceUnitAtom = atomWithStorage<DistanceUnit>(
  'app-distance-unit',
  'meters'
)
export const timeUnitAtom = atomWithStorage<TimeUnit>(
  'app-time-unit',
  'seconds'
)
