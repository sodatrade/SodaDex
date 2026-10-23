import type { ReactNode } from 'react'
import type { Currency } from '../../liquidity/types'

/** A configured pool keeps its own quote and transaction builder behind the shared token picker. */
export interface PairExtension {
  currencies: readonly Currency[]
  matches: (from: Currency, to: Currency) => boolean
  render: (selection: PairSelection) => ReactNode
}
export interface PairSelection {
  from: Currency
  to: Currency
  onSelect: (side: 'from' | 'to') => void
  onReverse: () => void
}
