/**
 * Author: Shik Chen
 * Date: 2026-02-01
 * Purpose: Provides locale activation helpers and translation typing utilities.
 */
import { i18n } from '@lingui/core'
import { useLingui } from '@lingui/react/macro'

/** Shared i18n helpers for runtime locale activation and typed translations. */
/** Type for the Lingui `t` translation function from `useLingui()`. */
export type TranslateFn = ReturnType<typeof useLingui>['t']

/**
 * Dynamically load and activate the message catalog for the given locale.
 */
export async function dynamicActivate(locale: string) {
  const { messages } = await import(`./locales/${locale}/messages.mjs`)

  i18n.load(locale, messages)
  i18n.activate(locale)
}
