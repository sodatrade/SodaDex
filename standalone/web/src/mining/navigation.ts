export const MINING_TABS = ['fundraising', 'fragments', 'positions', 'history', 'launch', 'automation'] as const
export type MiningTab = typeof MINING_TABS[number]
export function miningTab(hash: string): MiningTab {
  const value = hash.replace(/^#/, '')
  return MINING_TABS.find((tab) => tab === value) ?? 'fundraising'
}
