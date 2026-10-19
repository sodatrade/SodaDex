import { ASSETS, type AssetId } from '../domain/assets'

export type Page = 'swap' | 'assets' | 'pools'

export const PAGE_PATHS: Record<Page, string> = { swap: '/', assets: '/assets', pools: '/pools' }

function pageFor(pathname: string): Page | undefined {
  const path = pathname.replace(/\/+$/, '') || '/'
  return (Object.keys(PAGE_PATHS) as Page[]).find((page) => PAGE_PATHS[page] === path)
}

export function assetPath(id: AssetId): string {
  return `${PAGE_PATHS.assets}?asset=${id}`
}

/**
 * Minimal History API router: the deployment already serves index.html for unknown paths, so
 * each page has a real, shareable URL without a routing library. Unknown paths fall back to swap.
 */
export class Router {
  page = $state<Page>('swap')
  asset = $state<AssetId | undefined>(undefined)
  /** Increments on every navigation, including to the same URL, so pages can react to a repeat. */
  version = $state(0)

  constructor() {
    this.#read()
  }

  #read(): void {
    const page = pageFor(location.pathname)
    if (!page) history.replaceState(history.state, '', PAGE_PATHS.swap + location.hash)
    this.page = page ?? 'swap'
    const asset = new URLSearchParams(location.search).get('asset')
    this.asset = this.page === 'assets' ? ASSETS.find((entry) => entry.id === asset)?.id : undefined
    this.version += 1
  }

  navigate = (to: string): void => {
    const target = new URL(to, location.href)
    if (target.origin !== location.origin) return
    if (target.pathname + target.search !== location.pathname + location.search) history.pushState(null, '', target)
    this.#read()
    window.scrollTo({ top: 0 })
  }

  /** Lets plain left clicks on internal links navigate in place; modified clicks keep browser behaviour. */
  link = (event: MouseEvent): void => {
    const anchor = event.currentTarget
    if (
      !(anchor instanceof HTMLAnchorElement) ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      anchor.target
    )
      return
    event.preventDefault()
    this.navigate(anchor.href)
  }

  /** Follows back/forward; returns the listener cleanup. */
  listen(): () => void {
    const pop = (): void => this.#read()
    window.addEventListener('popstate', pop)
    return () => window.removeEventListener('popstate', pop)
  }
}
