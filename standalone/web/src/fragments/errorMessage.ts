import type { Messages } from './messages'

/** Translate known failures; never render RPC calldata, vendor stacks or unknown text. */
export function fragmentErrorMessage(error: unknown, m: Messages): string {
  const safe = [m.amountError, m.quoteError, m.walletChanged, m.walletRequired, m.approval, m.actionError, m.tradingPaused, m.noBacking]
  const seen = new Set<unknown>(), parts: string[] = []
  let current = error
  for (let depth = 0; current && typeof current === 'object' && depth < 8 && !seen.has(current); depth++) {
    seen.add(current)
    const value = current as Record<string, unknown>
    if (value.code === 4001 || value.code === 'ACTION_REJECTED') return m.walletCancelled
    for (const field of ['name', 'shortMessage', 'message', 'details']) {
      const text = value[field]
      if (typeof text === 'string') {
        if (safe.includes(text)) return text
        parts.push(text.slice(0, 2000))
      }
    }
    current = value.cause
  }
  const text = parts.join(' ')
  if (/insufficient funds|insufficientfunds|total cost[\s\S]*exceeds[\s\S]*balance/i.test(text)) return m.insufficientOkb
  if (/user rejected|user denied|rejected the request/i.test(text)) return m.walletCancelled
  if (/slippage|too little received|insufficient output/i.test(text)) return m.priceChanged
  if (/timeout|timed out|failed to fetch|network|httprequest|rpc.*unavailable/i.test(text)) return m.networkUnavailable
  return m.actionError
}
