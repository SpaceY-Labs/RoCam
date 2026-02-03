import { i18n } from '@lingui/core'

/**
 * Dynamically load and activate the message catalog for the given locale.
 */
export async function dynamicActivate(locale: string) {
  const { messages } = await import(`./locales/${locale}/messages.mjs`)

  i18n.load(locale, messages)
  i18n.activate(locale)
}
