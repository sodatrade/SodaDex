import { defineConfig } from 'vitest/config'
import { resolveOptions } from './tooling/resolve'

export default defineConfig({
  define: { __DEV__: 'true' },
  resolve: resolveOptions,
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
})
