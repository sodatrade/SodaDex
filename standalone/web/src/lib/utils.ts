import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

// Prop helpers used by the shadcn-svelte components in ./components/ui.
export type WithoutChild<T> = T extends { child?: unknown } ? Omit<T, 'child'> : T
export type WithoutChildren<T> = T extends { children?: unknown } ? Omit<T, 'children'> : T
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null }
