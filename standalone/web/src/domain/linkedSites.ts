import links from '../../../site-links.json'
export type SiteStage = 'test' | 'production'
export function ignixLaunchUrl(stage: SiteStage): string { return links.ignix[stage] }
export const siteStage: SiteStage = links.stage === 'production' ? 'production' : 'test'
