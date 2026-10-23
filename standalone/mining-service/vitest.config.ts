import { defineConfig } from 'vitest/config'
export default defineConfig({ resolve: { alias: [
  { find: /^viem$/, replacement: import.meta.resolve('viem') },
  { find: /^viem\/accounts$/, replacement: import.meta.resolve('viem/accounts') },
] }, test: { include: ['test/**/*.test.ts'], fileParallelism: false } })
