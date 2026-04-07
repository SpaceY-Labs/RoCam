/**
 * Author: Zifan Si
 * Date: 2025-11-15
 * Purpose: Configures the frontend build, dev server, and Vitest environment.
 */
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import { lingui } from '@lingui/vite-plugin'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: ['@lingui/babel-plugin-lingui-macro'],
      },
    }),
    tsconfigPaths(),
    tailwindcss(),
    lingui(),
  ],
  server: {
    host: '0.0.0.0',
  },
  resolve: {
    alias: {
      '@tabler/icons-react': '@tabler/icons-react/dist/esm/icons/index.mjs',
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    alias: {
      // Replace Lingui macros with simple stubs in test environment
      '@lingui/react/macro': new URL(
        './src/test/lingui-macro-mock.tsx',
        import.meta.url
      ).pathname,
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/main.tsx',
        'src/test/**',
        'src/**/*.d.ts',
        'src/styles/**',
        'src/locales/**',
      ],
    },
  },
})
