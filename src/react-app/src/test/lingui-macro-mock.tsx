/**
 * Drop-in mock for @lingui/react/macro used via Vite alias in tests.
 * Replaces all macro components and hooks with simple pass-through implementations.
 */
import React from 'react'

export function Trans({ children }: { children?: React.ReactNode }) {
  return React.createElement(React.Fragment, null, children)
}

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

export const defineMessage = (msg: unknown) => msg
export const msg = (strings: TemplateStringsArray, ..._values: unknown[]) =>
  strings[0]
