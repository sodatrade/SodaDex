import { decodeFunctionResult, encodeFunctionData, type Hex } from 'viem'
import { CHAIN_ID, STABLE_ADDRESS, WOKB_ADDRESS, type Protocol } from '../domain/assets'
import { hexQuantity, rpc } from '../lib/rpc'
import { v3QuoterAbi, v4QuoterAbi } from './abis'
import { CONTRACTS, POOL_KEY, POOLS } from './config'
import { assertPair, minimumOutput } from './encoding'
import { TradeError, type PublicRpc, type Quote, type RouteProtocol, type TradeForm } from './types'

export async function latestTimestamp(read: PublicRpc = rpc): Promise<bigint> {
  const block = await read('eth_getBlockByNumber', ['latest', false])
  if (!block || typeof block !== 'object' || !('timestamp' in block)) throw new TradeError('tradeUnavailable')
  return hexQuantity(block.timestamp)
}
export async function quoteRoute(form: TradeForm, protocol: RouteProtocol, read: PublicRpc = rpc): Promise<Quote> {
  assertPair(form)
  const nativeIn = form.from === 'okb'
  let amountOut: bigint
  if (protocol === 'v3') {
    const data = encodeFunctionData({
      abi: v3QuoterAbi,
      functionName: 'quoteExactInputSingle',
      args: [
        {
          tokenIn: nativeIn ? WOKB_ADDRESS : STABLE_ADDRESS,
          tokenOut: nativeIn ? STABLE_ADDRESS : WOKB_ADDRESS,
          amountIn: form.amount,
          fee: 100,
          sqrtPriceLimitX96: 0n,
        },
      ],
    })
    const result = await read('eth_call', [{ to: CONTRACTS.v3Quoter, data }, 'latest'])
    amountOut = decodeFunctionResult({
      abi: v3QuoterAbi,
      functionName: 'quoteExactInputSingle',
      data: result as Hex,
    })[0]
  } else {
    const data = encodeFunctionData({
      abi: v4QuoterAbi,
      functionName: 'quoteExactInputSingle',
      args: [{ poolKey: POOL_KEY, zeroForOne: nativeIn, exactAmount: form.amount, hookData: '0x' }],
    })
    const result = await read('eth_call', [{ to: CONTRACTS.v4Quoter, data }, 'latest'])
    amountOut = decodeFunctionResult({
      abi: v4QuoterAbi,
      functionName: 'quoteExactInputSingle',
      data: result as Hex,
    })[0]
  }
  return { ...form, protocol, amountOut, minimumOut: minimumOutput(amountOut) }
}
export async function getQuote(
  form: TradeForm,
  preference: Protocol,
  read: PublicRpc = rpc,
  ready = POOLS.ready,
): Promise<Quote> {
  if (!ready) throw new TradeError('tradeNotReady')
  assertPair(form)
  if (hexQuantity(await read('eth_chainId')) !== BigInt(CHAIN_ID)) throw new TradeError('tradeUnavailable')
  if (preference !== 'auto') return quoteRoute(form, preference, read)
  const candidates = await Promise.allSettled([quoteRoute(form, 'v4', read), quoteRoute(form, 'v3', read)])
  const routes = candidates.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
  const best = routes.sort((a, b) => (a.amountOut === b.amountOut ? 0 : a.amountOut > b.amountOut ? -1 : 1))[0]
  if (!best) throw new TradeError('tradeUnavailable')
  return best
}
