import { encodeAbiParameters, encodeFunctionData, encodePacked, isAddress, parseAbiParameters, toHex, zeroAddress, type Address, type Hex } from 'viem'
import { poolKey } from '../liquidity/pools'
import { routerAbi } from './abis'
import { CONTRACTS, POOL_KEY_TYPE } from './config'
import { minimumOutput } from './encoding'
import { assertTradePool, poolTradeCurrencies } from './poolTradeValidation'
import type { PoolTradeQuote } from './poolTradeTypes'
import { TradeError, type Transaction } from './types'
const routerRecipient = '0x0000000000000000000000000000000000000002'
const currencyAmount = parseAbiParameters('address,uint256')
const v3Input = parseAbiParameters('address,uint256,uint256,bytes,bool,uint256[]')
const sweep = (owner: Address): Hex => encodeAbiParameters(parseAbiParameters('address,address,uint256'), [zeroAddress, owner, 0n])
const swapType = { type: 'tuple', components: [
  { name: 'poolKey', ...POOL_KEY_TYPE }, { name: 'zeroForOne', type: 'bool' },
  { name: 'amountIn', type: 'uint128' }, { name: 'amountOutMinimum', type: 'uint128' },
  { name: 'minHopPriceX36', type: 'uint256' }, { name: 'hookData', type: 'bytes' },
] } as const

/** Only canonical single-hop exact-input Router commands; destinations always belong to the wallet. */
export function buildPoolSwap(quote: PoolTradeQuote, owner: Address, deadline: bigint): Transaction {
  assertTradePool(quote.pool)
  if (!isAddress(owner) || owner === zeroAddress || deadline <= 0n || deadline >= 2n ** 256n ||
    typeof quote.zeroForOne !== 'boolean' || quote.amount <= 0n || quote.amount >= 2n ** 128n ||
    quote.minimumOut < minimumOutput(quote.amountOut, quote.slippageBps) || quote.minimumOut > quote.amountOut)
    throw new TradeError('tradeQuoteChanged')
  const [input, output] = poolTradeCurrencies(quote)
  let commands: Hex, inputs: Hex[]
  if (quote.pool.protocol === 'v3') {
    const path = encodePacked(['address', 'uint24', 'address'], [input.address, quote.pool.fee, output.address])
    const swap = encodeAbiParameters(v3Input, [output.native ? routerRecipient : owner, quote.amount, quote.minimumOut, path, !input.native, []])
    if (input.native) {
      commands = '0x0b000c04'
      inputs = [encodeAbiParameters(currencyAmount, [routerRecipient, quote.amount]), swap,
        encodeAbiParameters(currencyAmount, [owner, 0n]), sweep(owner)]
    } else if (output.native) {
      commands = '0x000c04'
      inputs = [swap, encodeAbiParameters(currencyAmount, [owner, quote.minimumOut]), sweep(owner)]
    } else {
      commands = '0x00'
      inputs = [swap]
    }
  } else {
    if (quote.minimumOut >= 2n ** 128n) throw new TradeError('tradeUnavailable')
    const swap = encodeAbiParameters([swapType], [{ poolKey: poolKey(quote.pool), zeroForOne: quote.zeroForOne,
      amountIn: quote.amount, amountOutMinimum: quote.minimumOut, minHopPriceX36: 0n, hookData: '0x' }])
    commands = '0x1004'
    inputs = [encodeAbiParameters(parseAbiParameters('bytes,bytes[]'), ['0x060c0f', [swap,
      encodeAbiParameters(currencyAmount, [input.address, quote.amount]),
      encodeAbiParameters(currencyAmount, [output.address, quote.minimumOut])]]), sweep(owner)]
  }
  return { from: owner, to: CONTRACTS.router, data: encodeFunctionData({ abi: routerAbi, functionName: 'execute', args: [commands, inputs, deadline] }),
    value: toHex(input.native ? quote.amount : 0n) }
}
