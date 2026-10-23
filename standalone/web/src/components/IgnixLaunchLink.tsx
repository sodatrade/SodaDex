import type { ReactElement } from 'react'
import { ignixLaunchUrl, siteStage } from '../domain/linkedSites'
import { usePreferences } from '../preferences/context'
import { Icon } from './primitives'
import './ignix-launch-link.css'
export function IgnixLaunchLink(): ReactElement {
  const { locale } = usePreferences()
  const label = locale === 'en' ? 'Launch' : locale === 'yue-HK' ? '發行' : '发行'
  const note = locale === 'en' ? `Opens IGNIX ${siteStage === 'test' ? 'test' : 'production'} launch page in a new tab`
    : locale === 'yue-HK' ? `喺新分頁開啟 IGNIX ${siteStage === 'test' ? '測試' : '正式'}發行頁`
      : `在新标签打开 IGNIX ${siteStage === 'test' ? '测试' : '生产'}发行页面`
  return <a className="nav-launch" href={ignixLaunchUrl(siteStage)} target="_blank" rel="noopener noreferrer" title={note} aria-label={`${label} · IGNIX · ${note}`}>
    {label}<Icon name="external" size={12} />
  </a>
}
