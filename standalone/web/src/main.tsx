import './styles.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { NETWORK } from './network'

// All public entrypoints share the three-tab product; old hash routes are normalized.
const App = lazy(async () => ({ default: (await import('./fragments/FragmentApp')).FragmentApp }))

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
