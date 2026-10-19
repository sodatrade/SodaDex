<script lang="ts">
  import type { Snippet } from 'svelte'
  import { Separator } from '$lib/components/ui/separator'

  let { children }: { children: Snippet } = $props()
</script>

<div class="flex flex-col gap-4">
  <Separator class="bg-border-soft" />
  <p class="text-[11px] leading-relaxed text-muted-foreground">{@render children()}</p>
</div>
