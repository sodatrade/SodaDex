<script lang="ts">
	import { Toaster as Sonner, type ToasterProps as SonnerProps } from "svelte-sonner";
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import OctagonXIcon from '@lucide/svelte/icons/octagon-x';
	import InfoIcon from '@lucide/svelte/icons/info';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';

	// SodaDEX passes the theme from its own preferences instead of mode-watcher.
	let { ...restProps }: SonnerProps = $props();
</script>

<Sonner
	class="toaster group"
	style="--normal-bg: var(--color-popover); --normal-text: var(--color-popover-foreground); --normal-border: var(--color-border); --border-radius: var(--radius);"
	toastOptions={{
		classes: {
			toast: "cn-toast !shadow-card",
			description: "!text-muted-foreground",
			actionButton: "!bg-primary !text-primary-foreground !rounded-full !px-3 !font-medium",
		},
	}}
	{...restProps}
>
	{#snippet loadingIcon()}
		<Loader2Icon class="size-4 animate-spin text-muted-foreground" />
	{/snippet}
	{#snippet successIcon()}
		<CircleCheckIcon class="size-4 text-highlight" />
	{/snippet}
	{#snippet errorIcon()}
		<OctagonXIcon class="size-4 text-destructive" />
	{/snippet}
	{#snippet infoIcon()}
		<InfoIcon class="size-4" />
	{/snippet}
	{#snippet warningIcon()}
		<TriangleAlertIcon class="size-4 text-warning" />
	{/snippet}
</Sonner>
