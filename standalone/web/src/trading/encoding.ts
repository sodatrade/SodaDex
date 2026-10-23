import {
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  parseAbiParameters,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem'
import { STABLE_ADDRESS, WOKB_ADDRESS } from '../domain/assets'
import { routerAbi } from './abis'
import { CONTRACTS, POOL_KEY, POOL_KEY_TYPE, SLIPPAGE_BPS } from './config'
import { TradeError, type Quote, type TradeForm, type Transaction } from './types'
const routerRecipient = '0x0000000000000000000000000000000000000002'
const currencyAmount = parseAbiParameters('address,uint256')
const sweep = (owner: Address): Hex =>
  encodeAbiParameters(parseAbiParameters('address,address,uint256'), [zeroAddress, owner, 0n])
export function minimumOutput(amountOut: bigint, slippageBps = Number(SLIPPAGE_BPS)): bigint {
  if (amountOut <= 0n) throw new TradeError('tradeUnavailable')
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10_000)
    throw new TradeError('tradeUnavailable')
  return (amountOut * (10_000n - BigInt(slippageBps)) + 9_999n) / 10_000n
}
export function assertPair(form: TradeForm): void {
  if (!((form.from === 'okb' && form.to === 'usdt0') || (form.from === 'usdt0' && form.to === 'okb')))
    throw new TradeError('tradeUnsupported')
  if (form.amount <= 0n || form.amount >= 2n ** 128n) throw new TradeError('tradeUnavailable')
}
/** Matches the pinned Universal Router 2.1.2 six-field V3 input and V4 action structs. */
export function buildSwap(quote: Quote, owner: Address, deadline: bigint): Transaction {
  assertPair(quote)
  if (quote.minimumOut <= 0n || quote.minimumOut > quote.amountOut) throw new TradeError('tradeQuoteChanged')
  const nativeIn = quote.from === 'okb'
  let commands: Hex
  let inputs: Hex[]
  if (quote.protocol === 'v3') {
    const path = encodePacked(
      ['address', 'uint24', 'address'],
      nativeIn ? [WOKB_ADDRESS, 100, STABLE_ADDRESS] : [STABLE_ADDRESS, 100, WOKB_ADDRESS],
    )
    const swap = encodeAbiParameters(parseAbiParameters('address,uint256,uint256,bytes,bool,uint256[]'), [
      nativeIn ? owner : routerRecipient,
      quote.amount,
      quote.minimumOut,
      path,
      !nativeIn,
      [],
    ])
    const unwrap = encodeAbiParameters(currencyAmount, [owner, nativeIn ? 0n : quote.minimumOut])
    commands = nativeIn ? '0x0b000c04' : '0x000c04'
    inputs = nativeIn
      ? [encodeAbiParameters(currencyAmount, [routerRecipient, quote.amount]), swap, unwrap, sweep(owner)]
      : [swap, unwrap, sweep(owner)]
  } else {
    if (quote.minimumOut >= 2n ** 128n) throw new TradeError('tradeUnavailable')
    const swapType = {
      type: 'tuple',
      components: [
        { name: 'poolKey', ...POOL_KEY_TYPE },
        { name: 'zeroForOne', type: 'bool' },
        { name: 'amountIn', type: 'uint128' },
        { name: 'amountOutMinimum', type: 'uint128' },
        { name: 'minHopPriceX36', type: 'uint256' },
        { name: 'hookData', type: 'bytes' },
      ],
    } as const
    const swap = encodeAbiParameters(
      [swapType],
      [
        {
          poolKey: POOL_KEY,
          zeroForOne: nativeIn,
          amountIn: quote.amount,
          amountOutMinimum: quote.minimumOut,
          minHopPriceX36: 0n,
          hookData: '0x',
        },
      ],
    )
    const settle = encodeAbiParameters(currencyAmount, [nativeIn ? zeroAddress : STABLE_ADDRESS, quote.amount])
    const take = encodeAbiParameters(currencyAmount, [nativeIn ? STABLE_ADDRESS : zeroAddress, quote.minimumOut])
    commands = '0x1004'
    inputs = [
      encodeAbiParameters(parseAbiParameters('bytes,bytes[]'), ['0x060c0f', [swap, settle, take]]),
      sweep(owner),
    ]
  }
  return {
    from: owner,
    to: CONTRACTS.router,
    data: encodeFunctionData({ abi: routerAbi, functionName: 'execute', args: [commands, inputs, deadline] }),
    value: toHex(nativeIn ? quote.amount : 0n),
  }
}
