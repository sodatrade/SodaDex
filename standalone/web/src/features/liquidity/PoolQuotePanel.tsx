import { useQuery } from '@tanstack/react-query'
import { useId, useState, type ReactElement } from 'react'
import { formatUnits } from 'viem'
import { Button, Icon } from '../../components/primitives'
import { parseAmount } from '../../domain/amount'
import type { LiquidityPool } from '../../liquidity/types'
import { usePreferences } from '../../preferences/context'
import { getPoolQuote } from '../../trading/poolQuotes'

export function PoolQuotePanel({ pool }: { pool: LiquidityPool }): ReactElement {
  const { t } = usePreferences()
  const id = useId()
  const [direction, setDirection] = useState(true)
  const [input, setInput] = useState('')
  const from = direction ? pool.currency0 : pool.currency1, to = direction ? pool.currency1 : pool.currency0
  const parsed = parseAmount(input, from.decimals)
  const valid = parsed.kind === 'valid' && parsed.units < 2n ** 128n
  const quote = useQuery({ queryKey: ['pool-quote', pool.protocol, pool.id, direction, valid ? parsed.units.toString() : ''],
    queryFn: () => getPoolQuote(pool, direction, valid ? parsed.units : 0n), enabled: valid && pool.initialized,
    retry: false, refetchInterval: 15_000 })
  return <section className="lp-quote" aria-label={t('quoteReadOnly')}>
    <p className="lp-muted">{t('quoteReadOnly')}</p>
    <label className="lp-field" htmlFor={id}>{t('pay')} · {from.symbol}
      <input id={id} value={input} onChange={(e) => setInput(e.target.value)} inputMode="decimal" placeholder="0"
        aria-invalid={parsed.kind === 'invalid'} autoComplete="off" />
    </label>
    <div className="lp-actions"><Button appearance="ghost" aria-label={t('changeDirection')}
      onClick={() => { setDirection((value) => !value); setInput('') }}><Icon name="arrow" size={16} />{from.symbol} / {to.symbol}</Button>
      <output aria-label={t('receiveAmount')}>{valid && quote.data !== undefined ? `${formatUnits(quote.data, to.decimals)} ${to.symbol}` : '—'}</output></div>
    {quote.isFetching && <p role="status">{t('quoteLoading')}</p>}
    {quote.isError && valid && <p className="error-text" role="alert">{t('tradeUnavailable')} <Button appearance="ghost" onClick={() => void quote.refetch()}>{t('quoteRetry')}</Button></p>}
  </section>
}
