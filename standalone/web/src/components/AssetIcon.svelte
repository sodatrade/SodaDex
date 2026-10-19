<script lang="ts">
  import type { AssetId } from '../domain/assets'
  import { cn } from '$lib/utils'

  let { assetId, size = 'md', class: className = '' }: { assetId: AssetId; size?: 'sm' | 'md' | 'lg'; class?: string } =
    $props()
  const wrapped = $derived(assetId === 'wokb')
  const src = $derived(assetId === 'usdt0' ? '/assets/usdt0.png' : wrapped ? '/assets/wokb.png' : '/assets/okb.png')
</script>

<span
  class={cn(
    'relative inline-grid shrink-0 place-items-center rounded-full',
    size === 'sm' ? 'size-7' : size === 'lg' ? 'size-12' : 'size-10',
    className,
  )}
  aria-hidden="true"
>
  <img {src} alt="" width="48" height="48" class="block size-full rounded-full object-contain" />
  {#if wrapped}
    <span
      class={cn(
        'absolute -right-0.5 -bottom-0.5 grid place-items-center rounded-full border-2 border-card bg-[#d5ff75] font-semibold text-[#243119]',
        size === 'sm' ? 'size-3 text-[8px]' : 'size-4 text-[10px]',
      )}>W</span
    >
  {/if}
</span>
