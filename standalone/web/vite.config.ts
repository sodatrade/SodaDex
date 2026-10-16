import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { local, resolveOptions } from './tooling/resolve'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production') },
  resolve: resolveOptions,
  server: {
    fs: { allow: [local('../../')] },
    proxy: {
      '/api/rpc': {
        target: 'https://rpc.ignix.bot',
        changeOrigin: true,
        rewrite: () => '/rpc/196',
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
