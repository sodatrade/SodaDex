import { getAddress, isAddress } from 'viem'
import type { Currency } from '../../liquidity/types'
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
/** Discovery labels only. Selecting a result requires a fresh importCurrency read. */
export async function referenceTokens(): Promise<Currency[]> {
  const response = await fetch('/api/reference/tokens', { signal: AbortSignal.timeout(12_000) })
  if (!response.ok) throw new Error('Token list unavailable')
  const body: unknown = await response.json()
  if (!record(body) || body.chainId !== 196 || !Array.isArray(body.tokens)) throw new Error('Invalid token list')
  return body.tokens.flatMap((value): Currency[] => {
    if (!record(value) || typeof value.address !== 'string' || !isAddress(value.address, { strict: false }) ||
      typeof value.symbol !== 'string' || value.symbol.length > 64 || typeof value.name !== 'string' || value.name.length > 256 ||
      typeof value.decimals !== 'number' || !Number.isInteger(value.decimals) || value.decimals < 0 || value.decimals > 255) return []
    return [{ address: getAddress(value.address), symbol: value.symbol, name: value.name, decimals: value.decimals, native: false }]
  })
}
