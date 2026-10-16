import { useState, type ReactElement } from 'react'
import { formatUnits } from 'viem'
import { Dialog } from '../../components/Dialog'
import { Button } from '../../components/primitives'
import type { LiquidityText } from '../../i18n/liquidity'
import { defaultLpSlippageBps, liquidityError, liquidityForBps } from '../../liquidity'
import {
  LiquidityError,
  type LiquidityErrorCode,
  type LiquidityOperation,
  type LiquidityPosition,
} from '../../liquidity/types'
import { decimalInput } from './presentation'
interface Props {
  position: LiquidityPosition
  kind: 'decrease' | 'collect'
  l: LiquidityText
  disabled: boolean
  preparing: boolean
  error?: LiquidityErrorCode
  onPreview: (operation: LiquidityOperation) => void
  onClose: () => void
}
export function ManagePositionDialog({
  position,
  kind,
  l,
  disabled,
  preparing,
  error,
  onPreview,
  onClose,
}: Props): ReactElement {
  const [percent, setPercent] = useState('100')
  const [slippage, setSlippage] = useState(formatUnits(BigInt(defaultLpSlippageBps(position.pool)), 2))
  const [localError, setError] = useState<LiquidityErrorCode>()
  const submit = (): void => {
    try {
      if (kind === 'collect') {
        onPreview({ kind, position })
        return
      }
      const bps = decimalInput(percent, 2)
      if (bps <= 0n || bps > 10000n) throw new LiquidityError('invalidAmount')
      const slippageBps = decimalInput(slippage, 2)
      if (slippageBps > 10000n) throw new LiquidityError('invalidSlippage')
      setError(undefined)
      onPreview({
        kind,
        position,
        liquidity: liquidityForBps(position.liquidity, Number(bps)),
        liquidityBps: Number(bps),
        slippageBps: Number(slippageBps),
      })
    } catch (cause) {
      setError(liquidityError(cause))
    }
  }
  return (
    <Dialog
      title={`${l(kind)} · #${position.tokenId}`}
      description={l(kind === 'decrease' ? 'removeHint' : 'collectHint')}
      onClose={onClose}
    >
      <form
        className="lp-form"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        {kind === 'decrease' && (
          <>
            <label className="lp-field">
              {l('percent')}
              <input
                data-dialog-autofocus
                inputMode="decimal"
                value={percent}
                onChange={(event) => setPercent(event.target.value)}
                disabled={disabled}
              />
            </label>
            <Button type="button" onClick={() => setPercent('100')} disabled={disabled}>
              {l('all')}
            </Button>
            <label className="lp-field">
              {l('slippage')}
              <input
                inputMode="decimal"
                value={slippage}
                onChange={(event) => setSlippage(event.target.value)}
                disabled={disabled}
              />
            </label>
            <p className="lp-muted">{l('slippageNote')}</p>
          </>
        )}
        {(localError || error) && (
          <p className="error-text" role="alert">
            {l(localError ?? error ?? 'failed')}
          </p>
        )}
        <Button type="submit" appearance="primary" disabled={disabled}>
          {l(preparing ? 'preparingPreview' : 'preview')}
        </Button>
      </form>
    </Dialog>
  )
}
