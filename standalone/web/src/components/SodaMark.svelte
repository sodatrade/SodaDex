<script lang="ts">
  import { cn } from '$lib/utils'

  let { decorative = false, class: className = '' }: { decorative?: boolean; class?: string } = $props()
</script>

<svg
  class={cn('size-8 shrink-0 fill-highlight', className)}
  viewBox="0 0 48 48"
  aria-hidden={decorative || undefined}
  role={decorative ? undefined : 'img'}
  aria-label={decorative ? undefined : 'SodaDEX'}
>
  <circle cx="20" cy="29" r="11" />
  <circle cx="35" cy="15" r="7" />
  <circle cx="17" cy="9" r="3.5" />
</svg>
