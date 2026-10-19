<script lang="ts">
  import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query'
  import { Toaster } from '$lib/components/ui/sonner'
  import * as Tooltip from '$lib/components/ui/tooltip'
  import Shell from './components/Shell.svelte'
  import { providePreferences } from './preferences/preferences.svelte'

  let {
    queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } }),
  }: { queryClient?: QueryClient } = $props()
  const preferences = providePreferences()
</script>

<QueryClientProvider client={queryClient}>
  <Tooltip.Provider delayDuration={200}>
    <Shell />
  </Tooltip.Provider>
</QueryClientProvider>
<!-- Bottom placement keeps toasts clear of the header, which wraps to two rows on phones. -->
<Toaster
  theme={preferences.theme}
  position="bottom-right"
  offset={24}
  mobileOffset={16}
  visibleToasts={3}
  containerAriaLabel={preferences.t('notifications')}
/>
