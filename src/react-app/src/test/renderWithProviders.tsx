/**
 * Test utility: render a component wrapped with all required providers.
 * Provides Lingui I18nProvider with English messages.
 */
import React from 'react'
import { render, type RenderOptions } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { i18n } from '@lingui/core'

// Activate a minimal English catalog so Trans/useLingui work in tests
i18n.load('en', {})
i18n.activate('en')

export function renderWithI18n(
  ui: React.ReactElement,
  options?: RenderOptions
) {
  return render(
    <I18nProvider i18n={i18n}>{ui}</I18nProvider>,
    options
  )
}
