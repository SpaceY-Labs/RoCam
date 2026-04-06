/**
 * Author: Zifan Si
 * Date: 2026-03-04
 * Purpose: Provides a shared render helper for frontend tests that require i18n.
 */
import React from 'react'
import { render, type RenderOptions } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { i18n } from '@lingui/core'

// Activate a minimal English catalog so Trans/useLingui work in tests
i18n.load('en', {})
i18n.activate('en')

/**
 * Renders a React element under the English Lingui provider used in tests.
 *
 * @param ui React element rendered by the test.
 * @param options Optional testing-library render configuration.
 * @returns Rendered testing-library result for the wrapped element.
 */
export function renderWithI18n(
  ui: React.ReactElement,
  options?: RenderOptions
) {
  return render(<I18nProvider i18n={i18n}>{ui}</I18nProvider>, options)
}
