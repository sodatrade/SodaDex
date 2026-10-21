import { useEffect, useId, useRef, useState, type ReactElement } from 'react'
import { formatUnits } from 'viem'
import { Dialog } from '../../components/Dialog'
import { Button } from '../../components/primitives'
import type { LiquidityText } from '../../i18n/liquidity'
import { defaultLpSlippageBps, fullRange, liquidityError } from '../../liquidity'
import {
  LiquidityError,
  type LiquidityErrorCode,
  type LiquidityOperation,
  type LiquidityPool,
  type LiquidityPosition,
} from '../../liquidity/types'
import { CurrencyConfiguration } from './CurrencyConfiguration'
import { CurrencyLabel } from './CurrencyLabel'
import { decimalInput, integerInput } from './presentation'
interface Props {
  pool?: LiquidityPool
  position?: LiquidityPosition
  l: LiquidityText
  disabled: boolean
  preparing: boolean
  error?: LiquidityErrorCode
  onPreview: (operation: LiquidityOperation) => void
  onClose: () => void
  specialPool?: { label: string; onChoose: () => void }
}
export function MintWizard({
  pool: initialPool,
  position,
  l,
  disabled,
  preparing,
  error,
  onPreview,
  onClose,
  specialPool,
}: Props): ReactElement {
  const [pool, setPool] = useState(initialPool ?? position?.pool)
  return (
    <Dialog title={l(position ? 'increase' : 'create')} description={l('test')} onClose={onClose}>
      {!pool ? (
        <CurrencyConfiguration l={l} disabled={disabled} onPool={setPool} specialPool={specialPool} />
      ) : (
        <AmountConfiguration
          pool={pool}
          position={position}
          l={l}
          disabled={disabled}
          preparing={preparing}
          error={error}
          onPreview={onPreview}
          onBack={!initialPool && !position ? () => setPool(undefined) : undefined}
        />
      )}
    </Dialog>
  )
}
function AmountConfiguration({
  pool,
  position,
  l,
  disabled,
  preparing,
  error,
  onPreview,
  onBack,
}: Omit<Props, 'pool' | 'onClose'> & { pool: LiquidityPool; onBack?: () => void }): ReactElement {
  const id = useId()
  const amountInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    amountInput.current?.focus()
  }, [])
  const [amount0, setAmount0] = useState('')
  const [amount1, setAmount1] = useState('')
  const [price, setPrice] = useState('')
  const [custom, setCustom] = useState(false)
  const bounds = fullRange(pool.tickSpacing)
  const [lower, setLower] = useState(String(position?.tickLower ?? bounds.tickLower))
  const [upper, setUpper] = useState(String(position?.tickUpper ?? bounds.tickUpper))
  const [slippage, setSlippage] = useState(formatUnits(BigInt(defaultLpSlippageBps(pool)), 2))
  const [localError, setLocalError] = useState<LiquidityErrorCode>()
  const submit = (): void => {
    try {
      const bps = decimalInput(slippage, 2)
      if (bps > 10000n) throw new LiquidityError('invalidSlippage')
      const amounts = {
        amount0: decimalInput(amount0, pool.currency0.decimals),
        amount1: decimalInput(amount1, pool.currency1.decimals),
        slippageBps: Number(bps),
      }
      const operation: LiquidityOperation = position
        ? { kind: 'increase', position, ...amounts }
        : {
            kind: 'mint',
            pool,
            ...amounts,
            ...(custom ? { tickLower: integerInput(lower), tickUpper: integerInput(upper) } : bounds),
            ...(!pool.initialized ? { initialPrice: price } : {}),
          }
      setLocalError(undefined)
      onPreview(operation)
    } catch (cause) {
      setLocalError(liquidityError(cause))
    }
  }
  return (
    <form
      className="lp-form"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div className="lp-pair">
        <CurrencyLabel currency={pool.currency0} />
        <span>/</span>
        <CurrencyLabel currency={pool.currency1} />
        <span className="lp-pill">{pool.protocol.toUpperCase()}</span>
      </div>
      {!pool.initialized && (
        <label className="lp-field">
          {l('initialPrice')}
          <span className="lp-muted">
            {l('priceHint', { base: pool.currency0.symbol, quote: pool.currency1.symbol })}
          </span>
          <input
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            inputMode="decimal"
            disabled={disabled}
            required
          />
        </label>
      )}
      {!position && (
        <fieldset className="lp-protocols" disabled={disabled}>
          <legend>{l('range')}</legend>
          <label>
            <input type="radio" name={`${id}-range`} checked={!custom} onChange={() => setCustom(false)} />
            {l('fullRange')}
          </label>
          <label>
            <input type="radio" name={`${id}-range`} checked={custom} onChange={() => setCustom(true)} />
            {l('customRange')}
          </label>
        </fieldset>
      )}
      {(custom || position) && (
        <div className="lp-form-grid">
          <label className="lp-field">
            {l('tickLower')}
            <input
              value={lower}
              inputMode="numeric"
              onChange={(event) => setLower(event.target.value)}
              disabled={disabled || !!position}
            />
          </label>
          <label className="lp-field">
            {l('tickUpper')}
            <input
              value={upper}
              inputMode="numeric"
              onChange={(event) => setUpper(event.target.value)}
              disabled={disabled || !!position}
            />
          </label>
        </div>
      )}
      {!position && (
        <p className="lp-muted">
          {l('rangeHint')} {l('tickSpacing')} {pool.tickSpacing}
        </p>
      )}
      <div className="lp-form-grid">
        <label className="lp-field">
          {l('amount0')} · {pool.currency0.symbol}
          <input
            data-dialog-autofocus
            ref={amountInput}
            value={amount0}
            onChange={(event) => setAmount0(event.target.value)}
            inputMode="decimal"
            disabled={disabled}
            placeholder="0"
            required
          />
        </label>
        <label className="lp-field">
          {l('amount1')} · {pool.currency1.symbol}
          <input
            value={amount1}
            onChange={(event) => setAmount1(event.target.value)}
            inputMode="decimal"
            disabled={disabled}
            placeholder="0"
            required
          />
        </label>
      </div>
      <label className="lp-field">
        {l('slippage')}
        <input
          value={slippage}
          onChange={(event) => setSlippage(event.target.value)}
          inputMode="decimal"
          disabled={disabled}
        />
      </label>
      <p className="lp-muted">{l('slippageNote')}</p>
      {(localError || error) && (
        <p className="error-text" role="alert">
          {l(localError ?? error ?? 'failed')}
        </p>
      )}
      <div className="lp-actions">
        {onBack && (
          <Button type="button" onClick={onBack} disabled={disabled}>
            {l('back')}
          </Button>
        )}
        <Button type="submit" appearance="primary" disabled={disabled}>
          {l(preparing ? 'preparingPreview' : 'preview')}
        </Button>
      </div>
    </form>
  )
}
