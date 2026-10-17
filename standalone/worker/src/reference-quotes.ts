import { same, ZERO } from './contracts'
import { BadRequest, hex, type Block } from './dex-data'
import { reference } from './reference-config'
import { referencePool } from './reference-pools'
import { referenceAddress, referenceToken } from './reference-tokens'
import { V3_QUOTE_READ, V4_QUOTE_READ } from './quote-requests'
import type { ReferenceQuoteResponse } from './reference-types'
import { call } from './upstream'
function number(value: string | null, maximum: number): number {
  if (value === null || !/^(0|[1-9][0-9]*)$/.test(value)) throw new BadRequest('Valid fee and tickSpacing required')
  const result = Number(value)
  if (!Number.isInteger(result) || result > maximum) throw new BadRequest('Invalid fee or tickSpacing')
  return result
}
export async function referenceQuote(url: URL, block: Block, upstreamFetch: typeof fetch): Promise<ReferenceQuoteResponse> {
  const protocol = url.searchParams.get('protocol')
  if (protocol !== 'v2' && protocol !== 'v3' && protocol !== 'v4') throw new BadRequest('Valid protocol required')
  if ((protocol === 'v2' && (url.searchParams.has('fee') || url.searchParams.has('tickSpacing'))) || (protocol === 'v3' && url.searchParams.has('tickSpacing'))) throw new BadRequest('Parameters do not match protocol')
  const tokenIn = referenceAddress(url.searchParams.get('tokenIn')), tokenOut = referenceAddress(url.searchParams.get('tokenOut'))
  if (same(tokenIn, tokenOut)) throw new BadRequest('Distinct tokens required')
  const raw = url.searchParams.get('amountInRaw')
  if (!raw || !/^[1-9][0-9]{0,77}$/.test(raw)) throw new BadRequest('Positive raw input amount required')
  const amountIn = BigInt(raw)
  if (amountIn >= 2n ** (protocol === 'v4' ? 128n : 256n)) throw new BadRequest('Input exceeds protocol amount type')
  const fee = protocol === 'v2' ? 3000 : number(url.searchParams.get('fee'), protocol === 'v3' ? 999999 : 1_000_000)
  const spacing = protocol === 'v4' ? number(url.searchParams.get('tickSpacing'), 32767) : null
  if (spacing === 0) throw new BadRequest('Positive tickSpacing required')
  const poolTokenIn = protocol !== 'v4' && same(tokenIn, ZERO) ? reference.wrappedNative : tokenIn
  const poolTokenOut = protocol !== 'v4' && same(tokenOut, ZERO) ? reference.wrappedNative : tokenOut
  if (same(poolTokenIn, poolTokenOut)) throw new BadRequest('Use native wrapping instead of a pool quote')
  const [input, output] = await Promise.all([referenceToken(poolTokenIn, block, upstreamFetch), referenceToken(poolTokenOut, block, upstreamFetch)])
  const zeroForOne = BigInt(input.address) < BigInt(output.address)
  const pool = await referencePool(protocol, zeroForOne ? input : output, zeroForOne ? output : input, fee, spacing, block, upstreamFetch)
  if (!pool) throw new BadRequest('Reference pool does not exist or is not initialized')
  let amountOut: bigint, gasEstimate: string | null = null
  if (protocol === 'v2') {
    const reserveIn = BigInt((zeroForOne ? pool.reserves.token0Raw : pool.reserves.token1Raw)!), reserveOut = BigInt((zeroForOne ? pool.reserves.token1Raw : pool.reserves.token0Raw)!)
    if (reserveIn <= 0n || reserveOut <= 0n) throw new BadRequest('Reference pool has no reserves')
    const withFee = amountIn * 997n // UniswapV2Library.getAmountOut: canonical 0.3% input fee.
    amountOut = withFee * reserveOut / (reserveIn * 1000n + withFee)
  } else {
    const result = protocol === 'v3'
      ? await call(V3_QUOTE_READ, reference.contracts.v3Quoter, 'quoteExactInputSingle', [{ tokenIn: poolTokenIn, tokenOut: poolTokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }], hex(block.number), upstreamFetch)
      : await call(V4_QUOTE_READ, reference.contracts.v4Quoter, 'quoteExactInputSingle', [{ poolKey: { currency0: pool.token0.address, currency1: pool.token1.address, fee, tickSpacing: spacing, hooks: ZERO }, zeroForOne, exactAmount: amountIn, hookData: '0x' }], hex(block.number), upstreamFetch)
    if (!Array.isArray(result) || typeof result[0] !== 'bigint' || typeof result[protocol === 'v3' ? 3 : 1] !== 'bigint') throw new Error('Invalid quoter result')
    amountOut = result[0]; gasEstimate = String(result[protocol === 'v3' ? 3 : 1])
  }
  if (amountOut <= 0n) throw new BadRequest('No positive reference quote for this amount')
  return { schemaVersion: 1, chainId: 196, source: 'uniswap', readOnly: true, asOf: block, protocol, poolId: pool.id, tokenIn, tokenOut, poolTokenIn, poolTokenOut, fee, tickSpacing: pool.tickSpacing, amountInRaw: raw, amountOutRaw: String(amountOut), gasEstimate }
}
