import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { preferencesPrepaint } from './tooling/preferences-prepaint'
import { local, resolveOptions } from './tooling/resolve'
import { networkProfile } from '../network-profile'

export default defineConfig({
  plugins: [react(), tailwindcss(), preferencesPrepaint(), { name: 'network-build-identity',
    generateBundle(): void {
      const p = networkProfile(process.env.VITE_SODADEX_NETWORK_PROFILE)
      this.emitFile({ type: 'asset', fileName: 'network-build.json', source: JSON.stringify({ id: p.id, chainId: p.chainId }) })
    },
  }],
  define: { __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production') },
  resolve: resolveOptions,
  server: {
    fs: { allow: [local('../../')] },
    proxy: {
      '/api/network': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/api/mining': { target: 'http://127.0.0.1:8787', changeOrigin: false },
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
