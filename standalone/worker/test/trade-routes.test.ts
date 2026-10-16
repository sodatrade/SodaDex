import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData, parseAbi, type Address, type Hex } from 'viem'
import { deployment, ZERO } from '../src/contracts'
import { validContractRequest } from '../src/trade-requests'
import { tradeRoute } from '../src/trade-routes'
import * as policy from '../../trading-policy'
import { ACTIONS, custody, execute, EXECUTE, nativeSweep, owner, pair, SWAP3, SWAP4, tokenA, tokenB, transaction, v3, v4 } from './trade-fixtures'
beforeEach(() => { vi.spyOn(policy, 'publicSwapsEnabled').mockReturnValue(true) })
afterEach(() => vi.restoreAllMocks())
const wrapped = deployment.wrappedNative as Address
const accepts = (tx: ReturnType<typeof v3>): boolean => validContractRequest(tx, true) && validContractRequest(tx, false)

const direct = (path: Hex, recipient: Address = owner, minHop: readonly bigint[] = [], payer = true): ReturnType<typeof v3> => transaction(execute('0x00', [encodeAbiParameters(SWAP3, [recipient, 100n, 90n, path, payer, minHop])]))

describe('canonical single-hop routing for self-created pools', () => {
  it.each([100, 500, 3000, 10000])('accepts arbitrary V3 tokens and exact fee %s in either direction', (fee) => {
    for (const [input, output] of [[tokenA, tokenB], [tokenB, tokenA]] as const) {
      const tx = v3(input, output, fee)
      expect(accepts(tx)).toBe(true)
      expect(tradeRoute(tx.data, owner, 0n)).toEqual({ protocol: 'v3', tokenIn: input, tokenOut: output, fee })
    }
  })
  it('only wraps or unwraps official WOKB for the two native V3 command sequences', () => {
    expect(accepts(v3(wrapped, tokenA, 500, 'nativeIn'))).toBe(true)
    expect(accepts(v3(tokenB, wrapped, 10000, 'nativeOut'))).toBe(true)
    expect(accepts(v3(tokenA, tokenB, 500, 'nativeIn'))).toBe(false)
    expect(accepts(v3(tokenB, tokenA, 500, 'nativeOut'))).toBe(false)
    expect(accepts({ ...v3(wrapped, tokenA, 500, 'nativeIn'), value: '0x0' })).toBe(false)
    expect(accepts({ ...v3(tokenB, wrapped, 500, 'nativeOut'), value: '0x64' })).toBe(false)
  })
  it('accepts sorted hookless V4 native and ERC20 pairs in both directions with exact native value', () => {
    for (const [input, output] of [[ZERO, tokenA], [tokenA, ZERO], [tokenA, tokenB], [tokenB, tokenA]] as const) {
      const tx = v4(input, output)
      expect(accepts(tx)).toBe(true)
      expect(accepts({ ...tx, value: tx.value === '0x0' ? '0x64' : '0x0' })).toBe(false)
    }
    expect(accepts(v4(tokenA, tokenB, 1_000_000, 32767))).toBe(true)
    expect(accepts(v4(tokenA, tokenB, 500, 10, tokenA))).toBe(false)
    expect(accepts(v4(tokenA, tokenA))).toBe(false)
    expect(accepts(v4(tokenA, tokenB, 500, 0))).toBe(false)
  })
  it('rejects multihop, identical/zero token, nonempty min-hop protection and diverted direct recipient', () => {
    const path = `${tokenA}000bb8${tokenB.slice(2)}` as Hex
    expect(accepts(direct(`${path}0001f4${wrapped.slice(2)}`))).toBe(false)
    expect(accepts(direct(path, tokenB))).toBe(false)
    expect(accepts(direct(path, owner, [1n]))).toBe(false)
    expect(accepts(direct(path, owner, [], false))).toBe(false)
    expect(accepts(v3(ZERO, tokenA))).toBe(false)
    expect(accepts(v3(tokenA, tokenA))).toBe(false)
    expect(accepts(v3(tokenA, tokenB, 1_000_000))).toBe(false)
  })
  it('rejects reordered actions, wrong settlement/take, arbitrary hookData and redirected native refunds', () => {
    const tx = v4(ZERO, tokenA)
    const top = decodeFunctionData({ abi: EXECUTE, data: tx.data }).args
    const [, inner] = decodeAbiParameters(ACTIONS, top[1][0])
    const [swap] = decodeAbiParameters(SWAP4, inner[0])
    const variants: Hex[][] = [
      [inner[0], encodeAbiParameters(pair, [tokenB, 100n]), inner[2]],
      [inner[0], encodeAbiParameters(pair, [ZERO, 99n]), inner[2]],
      [inner[0], inner[1], encodeAbiParameters(pair, [tokenA, 89n])],
      [encodeAbiParameters(SWAP4, [[swap[0], swap[1], swap[2], swap[3], 0n, '0x01']]), inner[1], inner[2]],
    ]
    for (const params of variants) expect(accepts(transaction(execute('0x1004', [encodeAbiParameters(ACTIONS, ['0x060c0f', params]), nativeSweep()]), '0x64'))).toBe(false)
    expect(accepts(transaction(execute('0x1004', [top[1][0], nativeSweep(tokenB)]), '0x64'))).toBe(false)
    expect(accepts(transaction(execute('0x1004', [encodeAbiParameters(ACTIONS, ['0x0c060f', inner]), nativeSweep()]), '0x64'))).toBe(false)
    expect(accepts(transaction(execute('0x8000', [top[1][0]])))).toBe(false)
  })
  it('requires canonical top-level and inner bytes, terminal payouts and exact native wrap amounts', () => {
    const tx = v3(wrapped, tokenA, 500, 'nativeIn')
    const [commands, inputs] = decodeFunctionData({ abi: EXECUTE, data: tx.data }).args
    expect(accepts({ ...tx, data: `${tx.data}00` })).toBe(false)
    expect(accepts({ ...tx, data: execute(commands, [inputs[0], `${inputs[1]}00`, inputs[2], inputs[3]]) })).toBe(false)
    expect(accepts({ ...tx, data: execute(commands, [inputs[0], inputs[1], inputs[3], inputs[2]]) })).toBe(false)
    expect(accepts({ ...tx, data: execute(commands, [encodeAbiParameters(pair, [custody, 99n]), ...inputs.slice(1)]) })).toBe(false)
  })
})

describe('generic finite permits and official wrapped native', () => {
  it('allows finite Router Permit2 approvals for arbitrary nonzero tokens; no foreign spender or unlimited lifetime', () => {
    const abi = parseAbi(['function approve(address,address,uint160,uint48)'])
    const permit = (token: Address, spender: Address = deployment.contracts.universalRouter as Address, amount = 100n, expiration = 2_000_000_000): object => ({ from: owner, to: deployment.permit2, data: encodeFunctionData({ abi, functionName: 'approve', args: [token, spender, amount, expiration] }) })
    expect(validContractRequest(permit(tokenA), true)).toBe(true)
    for (const tx of [permit(ZERO), permit(tokenA, owner), permit(tokenA, undefined, 2n ** 160n - 1n), permit(tokenA, undefined, 100n, 0), permit(tokenA, undefined, 100n, 2 ** 48 - 1)]) expect(validContractRequest(tx, true)).toBe(false)
    vi.mocked(policy.publicSwapsEnabled).mockReturnValue(false)
    expect(validContractRequest(permit(tokenA), true)).toBe(false)
    expect(validContractRequest(permit(tokenA, undefined, 0n), true)).toBe(true)
    expect(accepts(v3())).toBe(false)
    expect(accepts(v4())).toBe(false)
  })
  it('allows only canonical official WOKB deposit/withdraw with correct native value, independently of swap pause', () => {
    vi.mocked(policy.publicSwapsEnabled).mockReturnValue(false)
    const abi = parseAbi(['function deposit() payable', 'function withdraw(uint256)'])
    const deposit = { from: owner, to: wrapped, data: encodeFunctionData({ abi, functionName: 'deposit' }), value: '0x64' }
    const withdraw = { from: owner, to: wrapped, data: encodeFunctionData({ abi, functionName: 'withdraw', args: [100n] }), value: '0x0' }
    for (const tx of [deposit, withdraw]) for (const simulation of [true, false]) expect(validContractRequest(tx, simulation)).toBe(true)
    for (const tx of [{ ...deposit, to: tokenA }, { ...deposit, value: '0x0' }, { ...deposit, data: `${deposit.data}00` }, { ...withdraw, value: '0x64' }, { ...withdraw, data: encodeFunctionData({ abi, functionName: 'withdraw', args: [0n] }) }]) expect(validContractRequest(tx, true)).toBe(false)
  })
})
