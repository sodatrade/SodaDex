import { decodeFunctionData, encodeFunctionData, parseAbi, type Hex } from 'viem'
import { deployment, same, ZERO, type PoolReference } from './contracts'
export const V3_QUOTE_READ = parseAbi(['function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns(uint256,uint160,uint32,uint256)'])
export const V4_QUOTE_READ = parseAbi(['function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns(uint256,uint256)'])
export function quoteRequest(to: string, data: Hex): PoolReference | null {
  try {
    if (same(to, deployment.contracts.v3Quoter)) {
      const decoded = decodeFunctionData({ abi: V3_QUOTE_READ, data })
      const [p] = decoded.args
      if (!same(encodeFunctionData({ abi: V3_QUOTE_READ, functionName: decoded.functionName, args: decoded.args }), data) || same(p.tokenIn, ZERO) || same(p.tokenOut, ZERO) || same(p.tokenIn, p.tokenOut) || p.fee >= 1_000_000 || p.amountIn <= 0n || p.sqrtPriceLimitX96 !== 0n) return null
      return { protocol: 'v3', tokenIn: p.tokenIn, tokenOut: p.tokenOut, fee: p.fee }
    }
    if (same(to, deployment.contracts.v4Quoter)) {
      const decoded = decodeFunctionData({ abi: V4_QUOTE_READ, data })
      const [p] = decoded.args
      const key = p.poolKey
      if (!same(encodeFunctionData({ abi: V4_QUOTE_READ, functionName: decoded.functionName, args: decoded.args }), data) || BigInt(key.currency0) >= BigInt(key.currency1) || key.fee > 1_000_000 || key.tickSpacing <= 0 || key.tickSpacing > 32767 || !same(key.hooks, ZERO) || p.exactAmount <= 0n || p.hookData !== '0x') return null
      return { protocol: 'v4', key }
    }
    return null
  } catch { return null }
}
