import './liquidity.css'
import { useQuery } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import { formatUnits } from 'viem'
import { Button, Icon, Surface } from '../../components/primitives'
import { CHAIN_ID } from '../../domain/assets'
import { liquidityText } from '../../i18n/liquidity'
import type { WalletController } from '../../lib/useWallet'
import { listPools, listPositions } from '../../liquidity'
import type { LiquidityPool, LiquidityPosition } from '../../liquidity/types'
import { usePreferences } from '../../preferences/context'
import { CurrencyLabel } from './CurrencyLabel'
import { LiquidityPreviewDialog } from './LiquidityPreviewDialog'
import { LiquidityTransactionStatus } from './LiquidityTransactionStatus'
import { ManagePositionDialog } from './ManagePositionDialog'
import { MintWizard } from './MintWizard'
import { PoolDetailDialog } from './PoolDetailDialog'
import { PositionCard } from './PositionCard'
import { PositionLookup } from './PositionLookup'
import { sameAddress } from './presentation'
import { useLiquidityOperation } from './useLiquidityOperation'
interface Props {
  wallet: WalletController
  onConnect: () => void
  onSwap: () => void
}
type Editor =
  | { kind: 'mint'; pool?: LiquidityPool }
  | { kind: 'increase' | 'decrease' | 'collect'; position: LiquidityPosition }
export function LiquidityPage({ wallet, onConnect, onSwap }: Props): ReactElement {
  const [tab, setTab] = useState<'pools' | 'positions'>('pools')
  const [detail, setDetail] = useState<LiquidityPool>()
  const [editor, setEditor] = useState<Editor>()
  const [found, setFound] = useState<LiquidityPosition>()
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
  const positions = useQuery({
    queryKey: ['liquidity', 'positions', wallet.session?.address],
    queryFn: () => listPositions(wallet.session?.address ?? '0x0000000000000000000000000000000000000000'),
    enabled: !!wallet.session && correctChain,
    retry: false,
    refetchInterval: 30_000,
  })
  const busy = operation.preparing || operation.executing || !!operation.blocked
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
  const visiblePositions = positions.data ?? []
  const extraFound =
    found &&
    !visiblePositions.some((position) => position.protocol === found.protocol && position.tokenId === found.tokenId)
      ? [found]
      : []
  return (
    <section className="content-page lp-page" aria-labelledby="lp-title">
      <div className="lp-page-heading">
        <div className="page-heading">
          <span className="eyebrow">SodaDEX / X LAYER</span>
          <h1 id="lp-title">{l('title')}</h1>
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
        <Button appearance="ghost" onClick={operation.refresh} disabled={pools.isFetching || positions.isFetching}>
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
        <div className="lp-pool-list">
          <p className="lp-muted">{l('poolFilterNote')}</p>
          {pools.isPending ? (
            <p role="status">{l('loading')}</p>
          ) : pools.isError ? (
            <div className="lp-empty">
              <p role="alert">{l('loadFailed')}</p>
              <Button onClick={() => void pools.refetch()}>{l('retry')}</Button>
            </div>
          ) : pools.data.length === 0 ? (
            <p className="lp-empty">{l('emptyPools')}</p>
          ) : (
            pools.data.map((pool) => (
              <Surface className="lp-pool" key={`${pool.protocol}:${pool.id}`}>
                <div className="lp-pair">
                  <CurrencyLabel currency={pool.currency0} />
                  <span>/</span>
                  <CurrencyLabel currency={pool.currency1} />
                </div>
                <span className="lp-pill">
                  {pool.protocol.toUpperCase()} · {formatUnits(BigInt(pool.fee), 4)}%
                </span>
                <span className="lp-muted">{l(pool.initialized ? 'initialized' : 'notInitialized')}</span>
                <div className="lp-actions">
                  <Button appearance="ghost" onClick={() => setDetail(pool)}>
                    {l('details')}
                  </Button>
                  <Button onClick={() => open({ kind: 'mint', pool })} disabled={busy}>
                    {l('add')}
                  </Button>
                </div>
              </Surface>
            ))
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
              {positions.isPending ? (
                <p role="status">{l('loading')}</p>
              ) : positions.isError ? (
                <div className="lp-empty">
                  <p role="alert">{l('loadFailed')}</p>
                  <Button onClick={() => void positions.refetch()}>{l('retry')}</Button>
                </div>
              ) : visiblePositions.length === 0 && !found ? (
                <p className="lp-empty">{l('emptyPositions')}</p>
              ) : null}
              <div className="lp-position-list">
                {[...visiblePositions, ...extraFound].map((position) => (
                  <div key={`${position.protocol}:${position.tokenId}`}>
                    <PositionCard
                      position={position}
                      l={l}
                      disabled={busy || !owned(position)}
                      onAction={(kind) => open({ kind, position })}
                    />
                    {!owned(position) && <p className="lp-muted">{l('notOwner')}</p>}
                  </div>
                ))}
              </div>
              <PositionLookup l={l} onPosition={setFound} />
            </>
          ) : null}
        </div>
      )}
      <Button appearance="ghost" className="lp-back-swap" onClick={onSwap}>
        {l('backSwap')}
        <Icon name="arrow" size={15} />
      </Button>
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
          pool={editor.kind === 'mint' ? editor.pool : undefined}
          position={editor.kind === 'increase' ? editor.position : undefined}
          l={l}
          disabled={busy}
          preparing={operation.preparing}
          error={operation.error}
          onPreview={operation.prepare}
          onClose={closeEditor}
        />
      )}
      {editor && (editor.kind === 'decrease' || editor.kind === 'collect') && (
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
