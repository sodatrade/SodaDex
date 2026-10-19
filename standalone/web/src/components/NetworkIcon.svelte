<script lang="ts">
  import { cn } from '$lib/utils'

  let { small = false, class: className = '' }: { small?: boolean; class?: string } = $props()
</script>

<img
  class={cn('block shrink-0 object-contain', small ? 'size-3.5 rounded' : 'size-5.5 rounded-md', className)}
  src="/assets/xlayer.svg"
  alt=""
  aria-hidden="true"
  width={small ? 14 : 22}
  height={small ? 14 : 22}
/>
