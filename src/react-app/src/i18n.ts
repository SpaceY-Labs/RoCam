/**
 * Author: Zifan Si
 * Date: 2026-02-01
 * Purpose: Provides locale activation helpers and translation typing utilities.
 */
import { i18n } from '@lingui/core'
import { useLingui } from '@lingui/react/macro'

/** Shared i18n helpers for runtime locale activation and typed translations. */
/** Type for the Lingui `t` translation function from `useLingui()`. */
export type TranslateFn = ReturnType<typeof useLingui>['t']

/**
 * Dynamically loads and activates the message catalog for a locale.
 *
 * @param locale Locale key whose compiled message catalog should become active.
 * @returns Promise that resolves after the locale catalog has been loaded and activated.
 */
export async function dynamicActivate(locale: string) {
  const { messages } = await import(`./locales/${locale}/messages.mjs`)

  i18n.load(locale, messages)
  i18n.activate(locale)
}
