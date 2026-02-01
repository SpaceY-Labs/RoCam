import type { NavigateOptions } from 'react-router-dom'
import React from 'react'

import { HeroUIProvider } from '@heroui/system'
import { I18nProvider } from '@lingui/react'
import { i18n } from '@lingui/core'
import { useAtomValue } from 'jotai'
import { useHref, useNavigate } from 'react-router-dom'
import { Provider as JotaiProvider } from 'jotai'

import { dynamicActivate } from './i18n'
import { RocamProvider } from './network/rocamProvider'
import { languageAtom } from './store/languageAtom'

declare module '@react-types/shared' {
  interface RouterConfig {
    routerOptions: NavigateOptions
  }
}

function I18nLoader({ children }: { children: React.ReactNode }) {
  const language = useAtomValue(languageAtom)

  const [ready, setReady] = React.useState(false)
  React.useEffect(() => {
    dynamicActivate(language).then(() => setReady(true))
  }, [language])

  if (!ready) {
    return null
  }

  return <I18nProvider i18n={i18n}>{children}</I18nProvider>
}

export function Provider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()

  return (
    <JotaiProvider>
      <I18nLoader>
        <HeroUIProvider navigate={navigate} useHref={useHref}>
          <RocamProvider>{children}</RocamProvider>
        </HeroUIProvider>
      </I18nLoader>
    </JotaiProvider>
  )
}
