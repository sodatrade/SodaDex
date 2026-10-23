import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { preferencesPrepaint } from './tooling/preferences-prepaint'
import { local, resolveOptions } from './tooling/resolve'
import { miningDeploymentForProfile } from '../mining-products'
import { networkProfile } from '../network-profile'

const mount = process.env.SODADEX_WEB_MOUNT ?? '/'
if (mount !== '/' && (mount !== '/mining/' || !['1952-mining-test', '196-mining-test'].includes(process.env.VITE_SODADEX_NETWORK_PROFILE ?? ''))) throw new Error('Invalid network mount')

export default defineConfig({
  base: mount,
  plugins: [react(), tailwindcss(), preferencesPrepaint(), { name: 'network-build-identity',
    generateBundle(): void {
      const p = networkProfile(process.env.VITE_SODADEX_NETWORK_PROFILE)
      this.emitFile({ type: 'asset', fileName: 'network-build.json', source: JSON.stringify({ id: p.id, chainId: p.chainId, mount }) })
    },
  }],
  define: { __MINING_196_DEPLOYMENT__: JSON.stringify({ schemaVersion: 1, ...miningDeploymentForProfile('196-mining-test', process.env.SODADEX_MINING_196_DEPLOYMENT ? JSON.parse(process.env.SODADEX_MINING_196_DEPLOYMENT) : undefined) }), __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production') },
  resolve: resolveOptions,
  server: {
    fs: { allow: [local('../../')] },
    proxy: {
      '/api/fragments': { target: 'http://127.0.0.1:8787', changeOrigin: false },
      '/api/network': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/api/mining': { target: 'http://127.0.0.1:8787', changeOrigin: false },
      '/api/index': { target: 'http://127.0.0.1:8787', changeOrigin: false },
      '/api/dex': { target: 'http://127.0.0.1:8787', changeOrigin: false },
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
