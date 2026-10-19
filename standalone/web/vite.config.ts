import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { noServerPrebundle } from './tooling/no-server-prebundle'
import { preferencesPrepaint } from './tooling/preferences-prepaint'
import { local, resolveOptions } from './tooling/resolve'

export default defineConfig({
  plugins: [noServerPrebundle(), svelte(), tailwindcss(), preferencesPrepaint()],
  resolve: resolveOptions,
  server: {
    fs: { allow: [local('../../')] },
    proxy: {
      '/api/rpc': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (request) => {
            request.removeHeader('origin')
            request.setHeader('User-Agent', 'SodaDex/1.0')
          })
        },
      },
    },
  },
})
