<script lang="ts">
  let { eyebrow, id, title, description }: { eyebrow: string; id: string; title: string; description: string } = $props()
</script>

<div class="mb-8 flex flex-col gap-3 px-2">
  <span class="flex items-center gap-2.5 text-[10px] font-medium tracking-[0.2em] text-muted-foreground">
    <span class="size-1.5 bg-primary"></span>{eyebrow}
  </span>
  <h1 {id} class="text-3xl font-medium tracking-tight sm:text-[40px] sm:leading-tight">{title}</h1>
  <p class="max-w-xl text-sm leading-relaxed text-muted-foreground">{description}</p>
</div>
