import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { preferencesPrepaint } from './tooling/preferences-prepaint'
import { local, resolveOptions } from './tooling/resolve'

export default defineConfig({
  plugins: [react(), tailwindcss(), preferencesPrepaint()],
  define: { __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production') },
  resolve: resolveOptions,
  server: {
    fs: { allow: [local('../../')] },
    proxy: {
      '/api/network': { target: 'http://127.0.0.1:8787', changeOrigin: true },
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
