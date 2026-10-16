import type { ReactElement } from 'react'
import { formatUnits } from 'viem'
import { Dialog } from '../../components/Dialog'
import { Button } from '../../components/primitives'
import { EXPLORER_URL, shortenAddress } from '../../domain/assets'
import type { LiquidityText } from '../../i18n/liquidity'
import { CurrencyLabel } from './CurrencyLabel'
import { LiquidityTransactionStatus } from './LiquidityTransactionStatus'
import { tokenAmount } from './presentation'
import type { useLiquidityOperation } from './useLiquidityOperation'
interface Props {
  operation: ReturnType<typeof useLiquidityOperation>
  current: boolean
  l: LiquidityText
  onClose: () => void
}
export function LiquidityPreviewDialog({ operation, current, l, onClose }: Props): ReactElement | null {
  const review = operation.review
  if (!review) return null
  const { preview } = review,
    { pool } = preview
  const done = operation.progress?.stage === 'success'
  return (
    <Dialog title={l('review')} description={l('reviewNote')} onClose={onClose}>
      <div className="lp-pair">
        <CurrencyLabel currency={pool.currency0} />
        <span>/</span>
        <CurrencyLabel currency={pool.currency1} />
        <span className="lp-pill">{pool.protocol.toUpperCase()}</span>
      </div>
      <dl className="lp-review">
        <div>
          <dt>{l('actual')}</dt>
          <dd>
            {tokenAmount(preview.amount0, pool.currency0)}
            <br />
            {tokenAmount(preview.amount1, pool.currency1)}
          </dd>
        </div>
        <div>
          <dt>{l('minimum')}</dt>
          <dd>
            {tokenAmount(preview.minimum0, pool.currency0)}
            <br />
            {tokenAmount(preview.minimum1, pool.currency1)}
          </dd>
        </div>
        <div>
          <dt>{l('maximum')}</dt>
          <dd>
            {tokenAmount(preview.maximum0, pool.currency0)}
            <br />
            {tokenAmount(preview.maximum1, pool.currency1)}
          </dd>
        </div>
        <div>
          <dt>{l('liquidity')}</dt>
          <dd>{preview.liquidity.toString()}</dd>
        </div>
        <div>
          <dt>{l('fee')}</dt>
          <dd>{formatUnits(BigInt(pool.fee), 4)}%</dd>
        </div>
        <div>
          <dt>{l('slippage')}</dt>
          <dd>{formatUnits(BigInt(preview.slippageBps), 2)}%</dd>
        </div>
        <div>
          <dt>{l('recipient')}</dt>
          <dd>
            <a href={`${EXPLORER_URL}/address/${preview.owner}`} target="_blank" rel="noreferrer">
              {shortenAddress(preview.owner)}
            </a>
          </dd>
        </div>
        <div>
          <dt>{l('target')}</dt>
          <dd>
            <a href={`${EXPLORER_URL}/address/${preview.transaction.to}`} target="_blank" rel="noreferrer">
              {shortenAddress(preview.transaction.to)}
            </a>
          </dd>
        </div>
        <div>
          <dt>{l('deadline')}</dt>
          <dd>{new Date(Number(preview.deadline) * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC')}</dd>
        </div>
      </dl>
      <h3 className="lp-section-title">{l('approvals')}</h3>
      {preview.approvals.length === 0 ? (
        <p className="lp-muted">{l('noApprovals')}</p>
      ) : (
        <ul className="lp-approvals">
          {preview.approvals.map((entry, index) => (
            <li key={`${entry.currency.address}:${entry.spender}:${index}`}>
              <strong>
                {entry.currency.symbol}
                {entry.permit2 ? ' · Permit2' : ''}
              </strong>
              <span>
                {l('exactApproval', {
                  amount: formatUnits(entry.amount, entry.currency.decimals),
                  spender: shortenAddress(entry.spender),
                })}
              </span>
              {entry.permit2 && (
                <span>
                  Permit2 →{' '}
                  {l('exactApproval', {
                    amount: formatUnits(entry.amount, entry.currency.decimals),
                    spender: shortenAddress(preview.transaction.to),
                  })}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {preview.approvals.length > 0 && <p className="lp-muted">{l('approvalNote')}</p>}
      <p className="lp-muted">{l('test')}</p>
      <LiquidityTransactionStatus operation={operation} l={l} />
      {!current && !done && (
        <p className="error-text" role="alert">
          {l('identityChanged')}
        </p>
      )}
      <Button
        appearance="primary"
        className="lp-full-width"
        disabled={!done && (!current || operation.executing || operation.blocked || !!operation.error)}
        onClick={done ? onClose : operation.confirm}
      >
        {l(done ? 'close' : operation.executing ? 'stagePending' : 'confirm')}
      </Button>
    </Dialog>
  )
}
