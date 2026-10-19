import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'
import { defineConfig } from 'vitest/config'
import { noServerPrebundle } from './tooling/no-server-prebundle'
import { resolveOptions } from './tooling/resolve'

export default defineConfig({
  plugins: [noServerPrebundle(), svelte(), svelteTesting()],
  resolve: resolveOptions,
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    restoreMocks: true,
  },
})
