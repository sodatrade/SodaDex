import { decodeFunctionData, encodeFunctionData, isAddress, zeroAddress, type Hex } from 'viem'
import { V2, V2_ROUTER } from '../../v2-protocol'
import { same } from './contracts'

export interface V2Request { kind: 'add' | 'remove' | 'swap'; token0: string; token1: string; liquidity?: bigint }
const positive = (n: unknown): n is bigint => typeof n === 'bigint' && n > 0n && n < 2n ** 160n - 1n
const token = (a: unknown): a is string => typeof a === 'string' && isAddress(a, { strict: false }) && !same(a, zeroAddress)
/** Canonical single-pair Router02 calls only. Never supporting-fee tokens, arbitrary paths, permits or recipients. */
export function v2Request(to: string, data: Hex, from: string | undefined, value: bigint): V2Request | null {
  if (!same(to, V2.router) || !from || !token(from)) return null
  try {
    const d = decodeFunctionData({ abi: V2_ROUTER, data })
    if (!same(data, encodeFunctionData({ abi: V2_ROUTER, functionName: d.functionName, args: d.args }))) return null
    const args: readonly unknown[] = d.args, n = d.functionName
    if (!same(String(args.at(-2)), from) || !positive(args.at(-1))) return null
    if (n.startsWith('swap')) {
      const path = args.at(-3)
      if (!Array.isArray(path) || path.length !== 2 || !path.every(token) || same(path[0], path[1])) return null
      const nativeIn = n === 'swapExactETHForTokens' || n === 'swapETHForExactTokens'
      const nativeOut = n === 'swapExactTokensForETH' || n === 'swapTokensForExactETH'
      if (nativeIn ? !positive(value) || !same(path[0], V2.wrapped) : value !== 0n) return null
      if (nativeOut && !same(path[1], V2.wrapped)) return null
      if (!args.slice(0, -3).every(positive)) return null
      return { kind: 'swap', token0: path[0], token1: path[1] }
    }
    const native = n.endsWith('ETH'), add = n.startsWith('add')
    const token0 = args[0], token1 = native ? V2.wrapped : args[1]
    if (!token(token0) || !token(token1) || same(token0, token1)) return null
    const amounts = args.slice(native ? 1 : 2, -2)
    if (!amounts.every(positive)) return null
    if (native && add ? !positive(value) : value !== 0n) return null
    if (add) {
      const nums = amounts as bigint[]
      if (native ? nums[1] > nums[0] || nums[2] > value : nums[2] > nums[0] || nums[3] > nums[1]) return null
    }
    return { kind: add ? 'add' : 'remove', token0, token1, ...(!add ? { liquidity: amounts[0] as bigint } : {}) }
  } catch { return null }
}
