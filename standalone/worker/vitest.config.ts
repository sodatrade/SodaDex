import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
// Shared standalone sources must resolve against this Worker's own pinned package.
export default defineConfig({
  resolve: { alias: [
    { find: /^viem$/, replacement: fileURLToPath(new URL('./node_modules/viem/_esm/index.js', import.meta.url)) },
    { find: /^viem\/(.*)$/, replacement: fileURLToPath(new URL('./node_modules/viem/_esm/$1/index.js', import.meta.url)) },
  ] },
})
