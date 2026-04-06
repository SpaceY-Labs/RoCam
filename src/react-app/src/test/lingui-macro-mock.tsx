/**
 * Author: Zifan Si
 * Date: 2026-03-04
 * Purpose: Provides a lightweight stand-in for Lingui macro exports during frontend tests.
 */
import React from 'react'

/**
 * Renders translated children without macro processing in the test environment.
 *
 * @param children Optional child content supplied by the calling test component.
 * @returns Fragment-wrapped child content.
 */
export function Trans({ children }: { children?: React.ReactNode }) {
  return React.createElement(React.Fragment, null, children)
}

/**
 * Returns a simplified translation API for tests that do not compile Lingui macros.
 *
 * @returns Minimal translation helpers used by components under test.
 */
export function useLingui() {
  return {
    t: (strings: TemplateStringsArray | string, ...values: unknown[]) => {
      if (typeof strings === 'string') return strings
      if (!strings || !strings.raw) return ''

      return strings.reduce(
        (acc, str, i) =>
          acc + str + (values[i] !== undefined ? String(values[i]) : ''),
        ''
      )
    },
    i18n: {},
    _: (id: string) => id,
  }
}

/**
 * Returns the provided message descriptor unchanged for test compatibility.
 *
 * @param msg Message descriptor supplied by test code.
 * @returns Unmodified message descriptor.
 */
export const defineMessage = (msg: unknown) => msg

/**
 * Returns the untranslated template head for message macro compatibility in tests.
 *
 * @param strings Template string fragments supplied by the macro call.
 * @returns First template fragment as a plain string.
 */
export const msg = (strings: TemplateStringsArray, ..._values: unknown[]) =>
  strings[0]
