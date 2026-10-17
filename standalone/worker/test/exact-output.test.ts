import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData, encodeFunctionResult, parseAbiParameters, type Hex } from 'viem'
import { deployment, FACTORY_READ, STATE_READ, V3_POOL_READ, ZERO } from '../src/contracts'
import { quoteRequest, V3_QUOTE_READ, V4_QUOTE_READ } from '../src/quote-requests'
import { proxyRpc } from '../src/rpc'
import { validContractRequest } from '../src/trade-requests'
import { tradeRoute } from '../src/trade-routes'
import * as policy from '../../trading-policy'
import { ACTIONS, execute, EXECUTE, nativeSweep, owner, pair, request, SWAP3, SWAP4, tokenA, tokenB, transaction } from './trade-fixtures'
import { exact3, exact4, wrapped } from './exact-output-fixtures'
const registered = '0x4444444444444444444444444444444444444444'
const key = { currency0: ZERO, currency1: tokenA, fee: 500, tickSpacing: 10, hooks: ZERO } as const
const quote3 = encodeFunctionData({ abi: V3_QUOTE_READ, functionName: 'quoteExactOutputSingle', args: [{ tokenIn: tokenB, tokenOut: tokenA, amount: 50n, fee: 500, sqrtPriceLimitX96: 0n }] })
const quote4 = encodeFunctionData({ abi: V4_QUOTE_READ, functionName: 'quoteExactOutputSingle', args: [{ poolKey: key, zeroForOne: true, exactAmount: 50n, hookData: '0x' }] })
interface Body { id: number; method: string; params: [{ to: string; data: Hex }, string?] }
function upstream(available = true): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
    const body = JSON.parse(String(options?.body)) as Body
    const to = body.params[0].to.toLowerCase()
    let result: Hex = '0x'
    if (to === deployment.contracts.v3Factory.toLowerCase()) result = encodeFunctionResult({ abi: FACTORY_READ, functionName: 'getPool', result: available ? registered : ZERO })
    if (to === registered) result = encodeFunctionResult({ abi: V3_POOL_READ, functionName: 'slot0', result: [2n ** 96n, 0, 0, 0, 0, 0, true] })
    if (to === deployment.contracts.v4StateView.toLowerCase()) result = encodeFunctionResult({ abi: STATE_READ, functionName: 'getSlot0', result: [available ? 2n ** 96n : 0n, 0, 0, 500] })
    return Response.json({ jsonrpc: '2.0', id: body.id, result })
  })
}
const calls = (f: ReturnType<typeof upstream>): Body[] => f.mock.calls.map(([, options]) => JSON.parse(String(options?.body)) as Body)
beforeEach(() => { vi.spyOn(policy, 'publicSwapsEnabled').mockReturnValue(true) })
afterEach(() => vi.restoreAllMocks())
describe('canonical exact-output RPC boundary', () => {
  it('decodes the reversed V3 path into the logical registered pair and binds native refunds', () => {
    for (const [input, output, mode] of [[tokenA, tokenB, 'tokens'], [tokenB, tokenA, 'tokens'], [wrapped, tokenA, 'nativeIn'], [tokenA, wrapped, 'nativeOut']] as const) {
      const tx = exact3(input, output, mode)
      expect(validContractRequest(tx, true)).toBe(true)
      expect(tradeRoute(tx.data, owner, BigInt(tx.value))).toEqual({ protocol: 'v3', tokenIn: input.toLowerCase(), tokenOut: output.toLowerCase(), fee: 500 })
    }
    expect(validContractRequest(exact3(tokenA, tokenB, 'nativeIn'), true)).toBe(false)
    expect(validContractRequest(exact3(tokenA, tokenB, 'nativeOut'), true)).toBe(false)
  })
  it('allows V4 hookless exact output in both native and ERC20 directions', () => {
    for (const [input, output] of [[ZERO, tokenA], [tokenA, ZERO], [tokenA, tokenB], [tokenB, tokenA]] as const) {
      const tx = exact4(input, output)
      expect(validContractRequest(tx, true)).toBe(true)
      expect(validContractRequest({ ...tx, value: tx.value === '0x0' ? '0x64' : '0x0' }, true)).toBe(false)
    }
  })
  it('uses the same selected own-pool registration checks for quotes and simulations at the caller snapshot', async () => {
    for (const tx of [exact3(), exact4(), { to: deployment.contracts.v3Quoter, data: quote3 }, { to: deployment.contracts.v4Quoter, data: quote4 }]) {
      const fetcher = upstream()
      expect((await proxyRpc(request(tx as ReturnType<typeof exact3>), fetcher)).status).toBe(200)
      expect(calls(fetcher).every((c) => c.params[1] === '0x12345')).toBe(true)
      expect(calls(fetcher)[0].params[0].to).toBe(tradeRoute(tx.data, owner, 0n)?.protocol === 'v4' || tx.data === quote4 ? deployment.contracts.v4StateView : deployment.contracts.v3Factory)
      expect(calls(fetcher).at(-1)?.params[0]).toEqual(tx)
    }
  })
  it('rejects unregistered pools before invoking either Router or Quoter', async () => {
    for (const tx of [exact3(), exact4(), { to: deployment.contracts.v3Quoter, data: quote3 }, { to: deployment.contracts.v4Quoter, data: quote4 }]) {
      const fetcher = upstream(false)
      expect((await proxyRpc(request(tx as ReturnType<typeof exact3>), fetcher)).status).toBe(400)
      expect(fetcher).toHaveBeenCalledOnce()
    }
  })
  it('keeps quotes readable while swaps are paused and blocks every exact-output write simulation', async () => {
    vi.mocked(policy.publicSwapsEnabled).mockReturnValue(false)
    for (const tx of [exact3(), exact4()]) expect(validContractRequest(tx, true)).toBe(false)
    const fetcher = upstream()
    expect((await proxyRpc(request({ to: deployment.contracts.v3Quoter, data: quote3 } as ReturnType<typeof exact3>), fetcher)).status).toBe(200)
  })
  it('rejects official/foreign targets, noncanonical bytes, wrong native values and foreign quote selectors before upstream', async () => {
    const fetcher = upstream(), tx = exact3()
    for (const candidate of [{ ...tx, to: tokenA }, { ...tx, data: `${tx.data}00` as Hex }, { ...tx, value: '0x64' as Hex }, { ...tx, to: deployment.contracts.v3Quoter, data: quote4 }]) expect((await proxyRpc(request(candidate), fetcher)).status).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
    expect(quoteRequest(deployment.contracts.v3Quoter, `${quote3}00`)).toBe(null)
  })
  it('rejects diverted V3 proceeds/refunds, altered payer, multihop, old five-field encoding and empty exact amounts', () => {
    const tx = exact3(), [commands, inputs] = decodeFunctionData({ abi: EXECUTE, data: tx.data }).args
    const [recipient, out, maximum, path, payer] = decodeAbiParameters(SWAP3, inputs[0])
    const mutations = [
      encodeAbiParameters(SWAP3, [tokenB, out, maximum, path, payer, []]),
      encodeAbiParameters(SWAP3, [recipient, 0n, maximum, path, payer, []]),
      encodeAbiParameters(SWAP3, [recipient, out, 0n, path, payer, []]),
      encodeAbiParameters(SWAP3, [recipient, out, maximum, path, false, []]),
      encodeAbiParameters(SWAP3, [recipient, out, maximum, `${path}0001f4${wrapped.slice(2)}`, payer, []]),
      encodeAbiParameters(SWAP3, [recipient, out, maximum, path, payer, [1n]]),
      encodeAbiParameters(parseAbiParameters('address,uint256,uint256,bytes,bool'), [recipient, out, maximum, path, payer]),
    ]
    for (const data of mutations) expect(validContractRequest(transaction(execute(commands, [data])), true)).toBe(false)
    const native = exact3(wrapped, tokenA, 'nativeIn'), [nativeCommands, nativeInputs] = decodeFunctionData({ abi: EXECUTE, data: native.data }).args
    for (const replacement of [nativeSweep(tokenB), encodeAbiParameters(pair, [tokenB, 0n])]) {
      const changed = [...nativeInputs]; changed[replacement === nativeSweep(tokenB) ? 3 : 2] = replacement
      expect(validContractRequest({ ...native, data: execute(nativeCommands, changed) }, true)).toBe(false)
    }
  })
  it('requires V4 exact-output action order and exact settle/take caps with empty hooks', () => {
    const tx = exact4(ZERO, tokenA), [, inputs] = decodeFunctionData({ abi: EXECUTE, data: tx.data }).args
    const [, inner] = decodeAbiParameters(ACTIONS, inputs[0]), [swap] = decodeAbiParameters(SWAP4, inner[0])
    const malformed = [
      [inner[0], encodeAbiParameters(pair, [ZERO, 99n]), inner[2]],
      [inner[0], inner[1], encodeAbiParameters(pair, [tokenA, 49n])],
      [encodeAbiParameters(SWAP4, [[swap[0], swap[1], 0n, swap[3], 0n, '0x']]), inner[1], inner[2]],
      [encodeAbiParameters(SWAP4, [[[ZERO, tokenA, 500, 10, tokenB], swap[1], swap[2], swap[3], 0n, '0x']]), inner[1], inner[2]],
      [encodeAbiParameters(SWAP4, [[swap[0], swap[1], swap[2], swap[3], 1n, '0x']]), inner[1], inner[2]],
      [encodeAbiParameters(SWAP4, [[swap[0], swap[1], swap[2], swap[3], 0n, '0x01']]), inner[1], inner[2]],
    ]
    for (const params of malformed) expect(validContractRequest(transaction(execute('0x1004', [encodeAbiParameters(ACTIONS, ['0x080c0f', params]), nativeSweep()]), '0x64'), true)).toBe(false)
    expect(validContractRequest(transaction(execute('0x1004', [encodeAbiParameters(ACTIONS, ['0x0c080f', inner]), nativeSweep()]), '0x64'), true)).toBe(false)
  })
})
