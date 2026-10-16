import { useMutation } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import { Button } from '../../components/primitives'
import type { LiquidityText } from '../../i18n/liquidity'
import { getPosition, liquidityError } from '../../liquidity'
import { LiquidityError, type LiquidityPosition, type LiquidityProtocol } from '../../liquidity/types'
export function PositionLookup({
  l,
  onPosition,
}: {
  l: LiquidityText
  onPosition: (p: LiquidityPosition) => void
}): ReactElement {
  const [protocol, setProtocol] = useState<LiquidityProtocol>('v3')
  const [id, setId] = useState('')
  const lookup = useMutation({
    retry: false,
    mutationFn: async () => {
      if (!/^\d+$/.test(id)) throw new LiquidityError('invalidAmount')
      return getPosition(protocol, BigInt(id))
    },
    onSuccess: onPosition,
  })
  return (
    <details className="lp-import">
      <summary>{l('findNft')}</summary>
      <form
        className="lp-lookup"
        onSubmit={(event) => {
          event.preventDefault()
          lookup.mutate()
        }}
      >
        <label className="lp-field">
          {l('protocol')}
          <select value={protocol} onChange={(event) => setProtocol(event.target.value === 'v4' ? 'v4' : 'v3')}>
            <option value="v3">V3</option>
            <option value="v4">V4</option>
          </select>
        </label>
        <label className="lp-field">
          {l('tokenId')}
          <input value={id} inputMode="numeric" onChange={(event) => setId(event.target.value)} required />
        </label>
        <Button type="submit" disabled={lookup.isPending}>
          {l(lookup.isPending ? 'loading' : 'find')}
        </Button>
      </form>
      {lookup.error && (
        <p className="error-text" role="alert">
          {l(liquidityError(lookup.error))}
        </p>
      )}
    </details>
  )
}
