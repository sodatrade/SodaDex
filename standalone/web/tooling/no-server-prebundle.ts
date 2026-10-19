import type { Plugin } from 'vite'

/**
 * This is a client-only app, but vite-plugin-svelte prebundles the Svelte runtime for every
 * server-consumer environment (Vite's `ssr`, Vitest's runner). That prebundle fails resolving
 * `node:module`, so those environments load dependencies directly instead.
 */
export function noServerPrebundle(): Plugin {
  return {
    name: 'sodadex-no-server-prebundle',
    enforce: 'pre',
    configEnvironment(name, config) {
      const consumer = config.consumer ?? (name === 'client' ? 'client' : 'server')
      if (consumer === 'server') return { optimizeDeps: { noDiscovery: true, include: [], exclude: ['svelte'] } }
    },
  }
}
