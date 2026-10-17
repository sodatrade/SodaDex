import { useMutation } from '@tanstack/react-query'
import { useId, useState, type ReactElement } from 'react'
import { formatUnits, isAddress } from 'viem'
import { Button } from '../../components/primitives'
import { STABLE_ADDRESS } from '../../domain/assets'
import type { LiquidityText } from '../../i18n/liquidity'
import { discoverPool, importCurrency, KNOWN_CURRENCIES, NATIVE_CURRENCY, liquidityError } from '../../liquidity'
import { LiquidityError, type Currency, type LiquidityPool, type LiquidityProtocol } from '../../liquidity/types'
import { decimalInput, integerInput, sameAddress } from './presentation'
interface Props {
  l: LiquidityText
  disabled: boolean
  onPool: (pool: LiquidityPool) => void
}
export function CurrencyConfiguration({ l, disabled, onPool }: Props): ReactElement {
  const id = useId()
  const [protocol, setProtocol] = useState<LiquidityProtocol>('v3')
  const [currencies, setCurrencies] = useState<readonly Currency[]>(KNOWN_CURRENCIES)
  const [currencyA, setA] = useState(NATIVE_CURRENCY)
  const [currencyB, setB] = useState(
    KNOWN_CURRENCIES.find((c) => sameAddress(c.address, STABLE_ADDRESS)) ?? KNOWN_CURRENCIES[1],
  )
  const [address, setAddress] = useState('')
  const [fee, setFee] = useState('0.01')
  const [spacing, setSpacing] = useState('1')
  const discovery = useMutation({
    retry: false,
    mutationFn: async () => {
      const feeUnits = decimalInput(fee, 4)
      if (feeUnits > BigInt(Number.MAX_SAFE_INTEGER)) throw new LiquidityError('invalidPool')
      return discoverPool({
        protocol,
        currencyA,
        currencyB,
        fee: Number(feeUnits),
        ...(protocol === 'v4' ? { tickSpacing: integerInput(spacing) } : {}),
      })
    },
    onSuccess: onPool,
  })
  const importer = useMutation({
    retry: false,
    mutationFn: async () => {
      if (!isAddress(address, { strict: false })) throw new LiquidityError('invalidCurrency')
      return importCurrency(address)
    },
    onSuccess: (currency) => {
      setCurrencies((current) =>
        current.some((c) => sameAddress(c.address, currency.address) && c.native === currency.native)
          ? current
          : [...current, currency],
      )
      setB(currency)
      setAddress('')
    },
  })
  const busy = disabled || discovery.isPending || importer.isPending
  const select = (key: string, set: (c: Currency) => void): void => {
    const currency = currencies.find((c) => `${c.address}:${c.native}` === key)
    if (currency) set(currency)
  }
  return (
    <form
      className="lp-form"
      onSubmit={(event) => {
        event.preventDefault()
        discovery.mutate()
      }}
    >
      <fieldset className="lp-protocols" disabled={busy}>
        <legend>{l('protocol')}</legend>
        {(['v3', 'v4'] as const).map((value) => (
          <label key={value}>
            <input
              type="radio"
              name={`${id}-protocol`}
              checked={protocol === value}
              onChange={() => {
                setProtocol(value)
                setFee(value === 'v3' ? '0.01' : '0')
              }}
            />
            {value.toUpperCase()}
          </label>
        ))}
      </fieldset>
      <div className="lp-form-grid">
        {(
          [
            { key: 'currencyA', value: currencyA, set: setA },
            { key: 'currencyB', value: currencyB, set: setB },
          ] as const
        ).map((entry) => (
          <label className="lp-field" key={entry.key}>
            {l(entry.key)}
            <select
              data-dialog-autofocus={entry.key === 'currencyA' || undefined}
              value={`${entry.value.address}:${entry.value.native}`}
              onChange={(event) => select(event.target.value, entry.set)}
              disabled={busy}
            >
              {currencies.map((c) => (
                <option key={`${c.address}:${c.native}`} value={`${c.address}:${c.native}`}>
                  {c.symbol}
                  {c.native ? ` · ${l('native')}` : ''}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <details className="lp-import">
        <summary>{l('importToken')}</summary>
        <label className="lp-field">
          {l('address')}
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                if (address && !busy) importer.mutate()
              }
            }}
            placeholder="0x…"
            autoComplete="off"
            disabled={busy}
          />
        </label>
        <Button type="button" onClick={() => importer.mutate()} disabled={busy || !address}>
          {l(importer.isPending ? 'loading' : 'importAction')}
        </Button>
        {importer.isSuccess && <p role="status">{l('imported')}</p>}
        {importer.error && (
          <p className="error-text" role="alert">
            {l(liquidityError(importer.error))}
          </p>
        )}
      </details>
      <div className="lp-form-grid">
        <label className="lp-field">
          {l('feePercent')}
          <input inputMode="decimal" value={fee} onChange={(event) => setFee(event.target.value)} disabled={busy} />
        </label>
        {protocol === 'v4' && (
          <label className="lp-field">
            {l('tickSpacing')}
            <input
              inputMode="numeric"
              value={spacing}
              onChange={(event) => setSpacing(event.target.value)}
              disabled={busy}
            />
          </label>
        )}
      </div>
      <p className="lp-muted">{formatUnits(100n, 4)}% V3 · 0% V4</p>
      {discovery.error && (
        <p className="error-text" role="alert">
          {l(liquidityError(discovery.error))}
        </p>
      )}
      <Button appearance="primary" type="submit" disabled={busy}>
        {l(discovery.isPending ? 'loading' : 'next')}
      </Button>
    </form>
  )
}
