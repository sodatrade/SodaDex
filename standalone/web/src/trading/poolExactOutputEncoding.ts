import { encodeAbiParameters, encodeFunctionData, encodePacked, isAddress, parseAbiParameters, toHex, zeroAddress, type Address, type Hex } from 'viem'
import { poolKey } from '../liquidity/pools'
import { routerAbi } from './abis'
import { CONTRACTS, POOL_KEY_TYPE } from './config'
import { maximumInput } from './exactOutputMath'
import type { PoolExactOutputQuote } from './poolExactOutputTypes'
import { assertTradePool, poolTradeCurrencies } from './poolTradeValidation'
import { TradeError, type Transaction } from './types'
const custody = '0x0000000000000000000000000000000000000002'
const pair = parseAbiParameters('address,uint256')
const swap3 = parseAbiParameters('address,uint256,uint256,bytes,bool,uint256[]')
const swap4 = { type: 'tuple', components: [
  { name: 'poolKey', ...POOL_KEY_TYPE }, { name: 'zeroForOne', type: 'bool' },
  { name: 'amountOut', type: 'uint128' }, { name: 'amountInMaximum', type: 'uint128' },
  { name: 'minHopPriceX36', type: 'uint256' }, { name: 'hookData', type: 'bytes' },
] } as const
const sweep = (owner: Address): Hex => encodeAbiParameters(parseAbiParameters('address,address,uint256'), [zeroAddress, owner, 0n])

/** Pinned Router 2.1.2: reversed V3 output path and hookless V4 exact-output single. */
export function buildPoolExactOutput(quote: PoolExactOutputQuote, owner: Address, deadline: bigint): Transaction {
  assertTradePool(quote.pool)
  if (!isAddress(owner) || owner === zeroAddress || deadline <= 0n || deadline >= 2n ** 256n ||
    quote.tradeType !== 'exactOutput' || typeof quote.zeroForOne !== 'boolean' ||
    quote.amountOut <= 0n || quote.amountOut >= 2n ** 128n ||
    quote.maximumIn !== maximumInput(quote.amountIn, quote.slippageBps)) throw new TradeError('tradeQuoteChanged')
  const [input, output] = poolTradeCurrencies(quote)
  let commands: Hex, inputs: Hex[]
  if (quote.pool.protocol === 'v3') {
    // Exact-output callbacks start from the desired output and walk toward the payer.
    const path = encodePacked(['address', 'uint24', 'address'], [output.address, quote.pool.fee, input.address])
    const swap = encodeAbiParameters(swap3, [output.native ? custody : owner, quote.amountOut, quote.maximumIn, path, !input.native, []])
    if (input.native) {
      commands = '0x0b010c04'
      inputs = [encodeAbiParameters(pair, [custody, quote.maximumIn]), swap,
        encodeAbiParameters(pair, [owner, 0n]), sweep(owner)]
    } else if (output.native) {
      commands = '0x010c04'
      inputs = [swap, encodeAbiParameters(pair, [owner, quote.amountOut]), sweep(owner)]
    } else { commands = '0x01'; inputs = [swap] }
  } else {
    const swap = encodeAbiParameters([swap4], [{ poolKey: poolKey(quote.pool), zeroForOne: quote.zeroForOne,
      amountOut: quote.amountOut, amountInMaximum: quote.maximumIn, minHopPriceX36: 0n, hookData: '0x' }])
    commands = '0x1004'
    inputs = [encodeAbiParameters(parseAbiParameters('bytes,bytes[]'), ['0x080c0f', [swap,
      encodeAbiParameters(pair, [input.address, quote.maximumIn]), encodeAbiParameters(pair, [output.address, quote.amountOut])]]), sweep(owner)]
  }
  return { from: owner, to: CONTRACTS.router, value: toHex(input.native ? quote.maximumIn : 0n),
    data: encodeFunctionData({ abi: routerAbi, functionName: 'execute', args: [commands, inputs, deadline] }) }
}
