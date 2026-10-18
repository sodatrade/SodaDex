import { MINING_NATIVE_SYMBOL } from './deployment'
import { useState, type ReactElement } from 'react'
import { Button, Icon, Surface } from '../components/primitives'
import { usePreferences } from '../preferences/context'
import { MiningActionCard } from './ActionCard'
import { miningMessages } from './messages'
import type { MiningAction } from './plans'

interface Props {
  kind: 'fundraising' | 'fragments'; symbol?: string; hasPair?: boolean; listingId?: string; disabled: boolean; busy: boolean
  onConnect?: () => void
  onPreview: (action: MiningAction, amount: string, second: string, slip: number) => Promise<void>
}

/** Presentation-only task selection. Quotes, permissions and execution stay in the workspace. */
export function MiningActionWorkspace({ kind, symbol, hasPair = true, listingId, disabled, busy, onConnect, onPreview }: Props): ReactElement {
  const { locale } = usePreferences(), m = miningMessages(locale)
  const [selected, setSelected] = useState(0)
  const tasks: { title: string; subtitle: string; actions: MiningAction[]; note?: string; initialAmount?: string; icon: 'arrow' | 'layers' | 'wallet' | 'sun' }[] = kind === 'fragments' ? [
    { title: m.swap, subtitle: 'TEST-FAB / TEST-fFAB', actions: ['fragmentBuy', 'fragmentSell'], note: m.tradingFeeNote, icon: 'arrow' },
    { title: m.custody, subtitle: m.custodyHint, actions: ['depositMiner', 'redeemMiner'], note: m.fragmentNote, icon: 'layers' },
    { title: m.liquidity, subtitle: m.liquidityHint, actions: ['fragmentAdd', 'fragmentRemove'], note: m.lpNote, icon: 'layers' },
    { title: m.buyMiner, subtitle: m.buyMinerHint, actions: ['buyMiner'], note: m.marketNote, initialAmount: listingId, icon: 'wallet' },
  ] : [
    { title: m.swap, subtitle: `TEST-FAB / ${symbol}`, actions: ['projectBuy', 'projectSell'], icon: 'arrow' },
    { title: m.liquidity, subtitle: m.liquidityHint, actions: ['projectAdd', 'projectRemove'], note: m.lpNote, icon: 'layers' },
    { title: m.burnBoost, subtitle: m.burnHint, actions: ['burnBoost'], note: m.burnNote, icon: 'sun' },
    { title: m.getTestFab, subtitle: `${MINING_NATIVE_SYMBOL} / TEST-FAB`, actions: ['getTestFab'], note: m.testAssetNote, icon: 'wallet' },
  ]
  const task = tasks[selected], missingPair = kind === 'fundraising' && selected === 1 && !hasPair
  return <div className="mining-action-layout">
    <Surface className="mining-task-rail" role="group" aria-label={m.chooseAction}>
      <h2 className="mining-section-label">{m.chooseAction}</h2>
      <div className="mining-task-list">{tasks.map((item, index) => <Button key={item.title} appearance="ghost" className="mining-task"
        aria-pressed={selected === index} disabled={busy} onClick={() => setSelected(index)}>
        <span className="mining-task-icon"><Icon name={item.icon} size={18} /></span>
        <span><strong>{item.title}</strong><small>{item.subtitle}</small></span><Icon name="chevron" size={15} />
      </Button>)}</div>
    </Surface>
    <MiningActionCard key={`${kind}:${selected}:${symbol ?? ''}`} title={task.title} actions={task.actions} assetSymbol={symbol}
      initialAmount={task.initialAmount} note={missingPair ? `${m.miningNoLiquidity} ${task.note}` : task.note} disabled={disabled || missingPair} locked={busy} onConnect={onConnect} onPreview={onPreview} />
  </div>
}
