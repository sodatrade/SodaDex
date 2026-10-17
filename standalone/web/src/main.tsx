import './styles.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { NETWORK } from './network'

// The 1952 entry must not execute imports containing 196 assets, deployments or signed-order types.
const App = lazy(NETWORK.dexEnabled
  ? async () => ({ default: (await import('./App')).App })
  : async () => ({ default: (await import('./MiningNetworkApp')).MiningNetworkApp }))

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } })
const container = document.getElementById('root')
if (!container) {
  throw new Error('缺少 SodaDEX 页面容器')
}
createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<p role="status">SodaDEX · {NETWORK.chainName}</p>}><App /></Suspense>
    </QueryClientProvider>
  </StrictMode>,
)
