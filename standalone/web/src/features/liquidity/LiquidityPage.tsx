import { isVisibleProtocol, VISIBLE_POSITION_PROTOCOLS } from '../../domain/visibleProtocols'
import { listV2Positions } from '../../liquidity/v2Pools'
import { V2PositionRow } from './V2PositionRow'
import type { AnyPool, V2Pool } from '../../liquidity/v2Types'
import { V2LiquidityDialog } from './V2LiquidityDialog'
import './liquidity.css'
import { skipToken, useQueries, useQuery } from '@tanstack/react-query'
import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { Button, Icon } from '../../components/primitives'
import { Pagination, usePagination } from '../../components/Pagination'
import { CHAIN_ID } from '../../domain/assets'
import { liquidityText } from '../../i18n/liquidity'
import type { WalletController } from '../../lib/useWallet'
import { listAllPools as listPools, listPositions } from '../../liquidity'
import type { LiquidityPool, LiquidityPosition } from '../../liquidity/types'
import { usePreferences } from '../../preferences/context'
import { LiquidityPreviewDialog } from './LiquidityPreviewDialog'
import { LiquidityTransactionStatus } from './LiquidityTransactionStatus'
import { ManagePositionDialog } from './ManagePositionDialog'
import { MintWizard } from './MintWizard'
import { PoolDetailDialog } from './PoolDetailDialog'
import { PoolList } from './PoolList'
import { PositionCard } from './PositionCard'
import { sameAddress } from './presentation'
import { useLiquidityOperation } from './useLiquidityOperation'
import { confirmedPoolsKey, mergeConfirmedPools } from './confirmedPools'
interface Props {
  wallet: WalletController
  onConnect: () => void
  onBusyChange?: (busy: boolean) => void
  embedded?: boolean
  specialPool?: { label: string; row: ReactNode; onChoose: () => void }
  externalBusy?: boolean
}
type Editor =
  | { kind: 'mint'; pool?: LiquidityPool }
  | { kind: 'increase' | 'decrease' | 'collect' | 'transfer' | 'burn'; position: LiquidityPosition }
export function LiquidityPage({ wallet, onConnect, onBusyChange, embedded, specialPool, externalBusy }: Props): ReactElement {
  const [tab, setTab] = useState<'pools' | 'positions'>('pools')
  const [v2Editor, setV2Editor] = useState<V2Pool>()
  const [v2Busy, setV2Busy] = useState(false)
  const [detail, setDetail] = useState<LiquidityPool>()
  const [editor, setEditor] = useState<Editor>()
  const { locale } = usePreferences(),
    l = liquidityText(locale)
  const operation = useLiquidityOperation(wallet)
  const correctChain = wallet.session?.chainId === CHAIN_ID
  const pools = useQuery({
    queryKey: ['liquidity', 'pools'],
    queryFn: () => listPools(),
    retry: false,
    refetchInterval: 30_000,
  })
  const positions = useQueries({ queries: VISIBLE_POSITION_PROTOCOLS.map(protocol => ({
    queryKey: ['liquidity', 'positions', wallet.session?.address, protocol],
    queryFn: async () => (await listPositions(wallet.session?.address ?? '0x0000000000000000000000000000000000000000', undefined, protocol)).filter(p => p.protocol === protocol),
    enabled: !!wallet.session && correctChain,
    retry: false,
    refetchInterval: 30_000,
  })) })
  const confirmed = useQuery<AnyPool[]>({ queryKey: confirmedPoolsKey, queryFn: skipToken, initialData: [] })
  const visiblePools = mergeConfirmedPools(pools.data ?? [], confirmed.data ?? []).filter(pool => isVisibleProtocol(pool.protocol))
  const v2Positions = useQuery({ queryKey: ['liquidity', 'v2-positions', wallet.session?.address, visiblePools.map(p => `${p.protocol}:${p.id}`).join(',')],
    queryFn: () => listV2Positions(visiblePools.filter((p): p is V2Pool => p.protocol === 'v2'), wallet.session!.address),
    enabled: !!wallet.session && correctChain && (pools.isSuccess || visiblePools.some(p => p.protocol === 'v2')), retry: false, refetchInterval: 30_000 })
  const busy = operation.preparing || operation.executing || !!operation.blocked || !!externalBusy || v2Busy
  const navigationBusy = busy || !!operation.review || !!editor || !!detail || !!v2Editor
  useEffect(() => { onBusyChange?.(navigationBusy) }, [navigationBusy, onBusyChange])
  const open = (value: Editor): void => {
    if (!wallet.session) {
      onConnect()
      return
    }
    if (!correctChain) {
      void wallet.switchChain()
      return
    }
    if (!busy) setEditor(value)
  }
  const openPool = (pool: AnyPool): void => {
    if (pool.protocol === 'v2') {
      if (!wallet.session) { onConnect(); return }
      if (!correctChain) { void wallet.switchChain(); return }
      setEditor(undefined); setV2Editor(pool)
    } else setDetail(pool)
  }
  const closeEditor = (): void => {
    operation.cancel()
    setEditor(undefined)
  }
  const closeReview = (): void => {
    if (operation.progress?.stage === 'success') setEditor(undefined)
    operation.closeReview()
  }
  const owned = (position: LiquidityPosition): boolean =>
    !!wallet.session && correctChain && sameAddress(position.owner, wallet.session.address)
  const visiblePositions = positions.flatMap(query => query.data ?? [])
  const accountKey = `${wallet.session?.chainId}:${wallet.session?.address.toLowerCase() ?? ''}`
  const positionRows = [...visiblePositions.map(position => ({ kind: 'nft' as const, position })), ...(v2Positions.data?.positions ?? []).map(position => ({ kind: 'v2' as const, position }))]
  const positionPagination = usePagination(positionRows, accountKey)
  return (
    <section className={`content-page lp-page${embedded ? ' lp-embedded' : ''}`} aria-labelledby="lp-title">
      <div className="lp-page-heading">
        <div className="page-heading">
          <span className="eyebrow">SodaDEX / X LAYER</span>
          <h2 id="lp-title">{l('title')}</h2>
          <p>{l('description')}</p>
        </div>
        <Button appearance="primary" onClick={() => open({ kind: 'mint' })} disabled={busy}>
          {l('create')}
          <Icon name="layers" size={17} />
        </Button>
      </div>
      <p className="lp-test-note">{l('test')}</p>
      <div className="lp-toolbar">
        <div className="lp-tabs" role="group" aria-label={l('liquidity')}>
          <button aria-pressed={tab === 'pools'} onClick={() => setTab('pools')}>
            {l('pools')}
          </button>
          <button aria-pressed={tab === 'positions'} onClick={() => setTab('positions')}>
            {l('positions')}
          </button>
        </div>
        <Button appearance="ghost" onClick={operation.refresh} disabled={pools.isFetching || positions.every(query => query.isFetching)}>
          <Icon name="refresh" size={15} />
          {l('refresh')}
        </Button>
      </div>
      {wallet.session && !correctChain && (
        <div className="lp-gate">
          <p>{l('chainHint')}</p>
          <Button onClick={() => void wallet.switchChain()} disabled={wallet.status !== 'idle'}>
            {l('switchChain')}
          </Button>
        </div>
      )}
      <LiquidityTransactionStatus operation={operation} l={l} />
      {tab === 'pools' ? (
        <div className="lp-pool-section">
          <p className="lp-muted">{l('poolFilterNote')}</p>
          {pools.isError && visiblePools.length > 0 && <p role="alert">{l('loadFailed')} <Button onClick={() => void pools.refetch()}>{l('retry')}</Button></p>}
          {!pools.isSuccess && !visiblePools.length && specialPool && <PoolList pools={[]} l={l} disabled={busy} onDetails={openPool} extraRows={[{id:'configured-miner-pool',content:specialPool.row}]} />}
          {pools.isPending && !visiblePools.length ? (
            <p role="status">{l('loading')}</p>
          ) : pools.isError && !visiblePools.length ? (
            <div className="lp-empty">
              <p role="alert">{l('loadFailed')}</p>
              <Button onClick={() => void pools.refetch()}>{l('retry')}</Button>
            </div>
          ) : visiblePools.length === 0 && !specialPool ? (
            <p className="lp-empty">{l('emptyPools')}</p>
          ) : (
            <PoolList pools={visiblePools} l={l} disabled={busy} onDetails={openPool} extraRows={specialPool ? [{ id: 'configured-miner-pool', content: specialPool.row }] : undefined} />
          )}
        </div>
      ) : (
        <div>
          {!wallet.session ? (
            <div className="lp-empty">
              <p>{l('connectHint')}</p>
              <Button appearance="primary" onClick={onConnect}>
                {l('connect')}
              </Button>
            </div>
          ) : correctChain ? (
            <>
              {positions.map((query, index) => query.isPending ? <p key={index} role="status">{VISIBLE_POSITION_PROTOCOLS[index].toUpperCase()} · {l('loading')}</p> : query.isError ? <div key={index} className="lp-empty"><p role="alert">{VISIBLE_POSITION_PROTOCOLS[index].toUpperCase()} · {l('loadFailed')}</p><Button onClick={() => void query.refetch()}>{l('retry')}</Button></div> : null)}
              {positions.every(query => query.isSuccess) && v2Positions.isSuccess && positionRows.length === 0 ? (
                <p className="lp-empty">{l('emptyPositions')}</p>
              ) : null}
              {(v2Positions.isError || !!v2Positions.data?.unavailable) && <p role="alert">V2 · {l('loadFailed')} <Button onClick={() => void v2Positions.refetch()}>{l('retry')}</Button></p>}
              <div className="lp-position-list">
                {positionPagination.items.map((row) => {
                  if (row.kind === 'v2') return <V2PositionRow key={`v2:${row.position.pool.id}`} position={row.position} l={l} disabled={busy} onManage={() => openPool(row.position.pool)} />
                  const position = row.position
                  return (
                  <div key={`${position.protocol}:${position.tokenId}`}>
                    <PositionCard
                      position={position}
                      l={l}
                      disabled={busy || !owned(position)}
                      onAction={(kind) => open({ kind, position })}
                    />
                    {!owned(position) && <p className="lp-muted">{l('notOwner')}</p>}
                  </div>
                ) })}
              </div>
              <Pagination {...positionPagination} />
            </>
          ) : null}
        </div>
      )}
      {detail && (
        <PoolDetailDialog
          pool={detail}
          l={l}
          disabled={busy}
          onClose={() => setDetail(undefined)}
          onAdd={() => {
            setDetail(undefined)
            open({ kind: 'mint', pool: detail })
          }}
        />
      )}
      {editor && (editor.kind === 'mint' || editor.kind === 'increase') && (
        <MintWizard
          onV2Pool={openPool}
          pool={editor.kind === 'mint' ? editor.pool : undefined}
          position={editor.kind === 'increase' ? editor.position : undefined}
          l={l}
          disabled={busy}
          preparing={operation.preparing}
          error={operation.error}
          onPreview={operation.prepare}
          onClose={closeEditor}
          specialPool={specialPool ? { label: specialPool.label, onChoose: () => { closeEditor(); specialPool.onChoose() } } : undefined}
        />
      )}
      {editor && (editor.kind === 'decrease' || editor.kind === 'collect' || editor.kind === 'transfer' || editor.kind === 'burn') && (
        <ManagePositionDialog
          position={editor.position}
          kind={editor.kind}
          l={l}
          disabled={busy}
          preparing={operation.preparing}
          error={operation.error}
          onPreview={operation.prepare}
          onClose={closeEditor}
        />
      )}
      {v2Editor && <V2LiquidityDialog pool={v2Editor} wallet={wallet} onClose={() => { setV2Editor(undefined); setV2Busy(false) }} onBusyChange={setV2Busy} />}
      {operation.review && (
        <LiquidityPreviewDialog
          operation={operation}
          current={wallet.getIdentity()?.revision === operation.review.identity.revision}
          l={l}
          onClose={closeReview}
        />
      )}
    </section>
  )
}
