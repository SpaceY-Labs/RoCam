/**
 * Author: Zifan Si
 * Date: 2026-02-01
 * Purpose: Configures source locales and catalog generation for frontend translations.
 */
import { defineConfig } from '@lingui/cli'

export default defineConfig({
  sourceLocale: 'en',
  locales: ['en', 'fr'],
  compileNamespace: 'es',
  catalogs: [
    {
      path: '<rootDir>/src/locales/{locale}/messages',
      include: ['src'],
    },
  ],
})
