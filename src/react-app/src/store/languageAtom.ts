import { atomWithStorage } from 'jotai/utils'

export type Language = 'en' | 'fr'

export const languageAtom = atomWithStorage<Language>('app-language', 'en')
