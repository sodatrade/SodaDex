export const WORKSPACE_PAGES = ['swap', 'explore', 'portfolio', 'assets', 'pools', 'market', 'history', 'reference', 'nfts', 'activity'] as const
export type Page = typeof WORKSPACE_PAGES[number]
export function isPage(value: string): value is Page { return (WORKSPACE_PAGES as readonly string[]).includes(value) }
export function primaryPage(page: Page): 'swap' | 'explore' | 'pools' | 'portfolio' {
  if (['assets', 'nfts', 'activity', 'portfolio'].includes(page)) return 'portfolio'
  return ['explore', 'market', 'history', 'reference'].includes(page) ? 'explore' : page as 'swap' | 'pools'
}
export const EXPLORE_ROUTES = { tokens: 'explore', pools: 'market', transactions: 'history', reference: 'reference' } as const
export const PORTFOLIO_ROUTES = { overview: 'portfolio', tokens: 'assets', nfts: 'nfts', activity: 'activity' } as const
export function exploreTab(page: Page): keyof typeof EXPLORE_ROUTES {
  return page === 'market' ? 'pools' : page === 'history' ? 'transactions' : page === 'reference' ? 'reference' : 'tokens'
}
export function portfolioTab(page: Page): keyof typeof PORTFOLIO_ROUTES {
  return page === 'assets' ? 'tokens' : page === 'nfts' ? 'nfts' : page === 'activity' ? 'activity' : 'overview'
}
