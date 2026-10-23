import { decodeFunctionData, encodeFunctionResult, zeroAddress, type Address, type Hex } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as policy from '../../trading-policy'
import { WOKB_ADDRESS } from '../src/domain/assets'
import { buildTransfer, erc20TransferAbi, executeTransfer, type TransferRequest } from '../src/trading/transfers'
import { TradeError, type PublicRpc } from '../src/trading/types'
import { executeWrap } from '../src/trading/wrapping'
import { hash, owner, selectedPool, tokenA, tradeFixture } from './poolTradeFixture'
const recipient = '0x7777777777777777777777777777777777777777' as const
const native = { ...tokenA, address: zeroAddress, native: true, symbol: 'OKB' }
const request: TransferRequest = { currency: tokenA, recipient, amount: 10n }
beforeEach(() => { vi.spyOn(policy, 'publicSwapsEnabled').mockReturnValue(false) })
function fixture(balance = 100n, result: Hex = `0x${'0'.repeat(63)}1`) {
  const f = tradeFixture(selectedPool('v3'))
  const read = vi.fn<PublicRpc>(async (method, params) => {
    const tx = params?.[0] as { to?: string; data?: string } | undefined
    if (method === 'eth_call' && tx?.data?.startsWith('0x70a08231'))
      return encodeFunctionResult({ abi: erc20TransferAbi, functionName: 'balanceOf', result: balance })
    if (method === 'eth_call' && tx?.data?.startsWith('0xa9059cbb')) return result
    return f.read(method, params)
  })
  return { ...f, read, context: { ...f.context, read } }
}
describe('same-chain native and ERC20 sends', () => {
  it.each([false, true])('sends native=%s with no approval while swaps are paused', async (isNative) => {
    const f = fixture(), transfer = { ...request, currency: isNative ? native : tokenA }
    await expect(executeTransfer(transfer, f.context)).resolves.toBe(hash)
    expect(f.submitted).toHaveLength(1)
    const tx = f.submitted[0]
    if (isNative) expect(tx).toMatchObject({ from: owner, to: recipient, data: '0x', value: '0xa' })
    else {
      expect(tx).toMatchObject({ from: owner, to: tokenA.address, value: '0x0' })
      expect(decodeFunctionData({ abi: erc20TransferAbi, data: tx.data })).toMatchObject({ functionName: 'transfer', args: [recipient, 10n] })
    }
    expect(f.events.at(-1)).toMatchObject({ stage: 'tradeSucceeded', hash })
    expect(f.wait).toHaveBeenCalledOnce()
  })
  it('supports an empty-return ERC20 transfer', async () => {
    const f = fixture(100n, '0x')
    await expect(executeTransfer(request, f.context)).resolves.toBe(hash)
    expect(f.submitted).toHaveLength(1)
  })
  it.each([`0x${'0'.repeat(64)}`, `0x${'0'.repeat(63)}2`, '0x01'] as Hex[])('blocks a false or malformed transfer result %s', async (result) => {
    const f = fixture(100n, result)
    await expect(executeTransfer(request, f.context)).rejects.toThrow(result.endsWith('0') ? 'tradeReverted' : 'tradeFailed')
    expect(f.submitted).toEqual([])
  })
  it('checks the actual ERC20 balance before opening any wallet request', async () => {
    const f = fixture(9n)
    await expect(executeTransfer(request, f.context)).rejects.toThrow('tradeUnavailable')
    expect(f.submitted).toEqual([])
    expect(f.identity.provider.request).not.toHaveBeenCalled()
  })
  it('checks native input plus gas, including a balance equal to the transfer amount', async () => {
    const f = fixture()
    const read: PublicRpc = async (method, params) => method === 'eth_getBalance' ? '0xa' : f.read(method, params)
    await expect(executeTransfer({ ...request, currency: native }, { ...f.context, read })).rejects.toThrow('tradeGasBalance')
    expect(f.submitted).toEqual([])
  })
  it('rejects malformed or zero destinations, invalid currencies and out-of-range amounts before RPC', async () => {
    const f = fixture()
    for (const invalid of [
      { ...request, recipient: zeroAddress }, { ...request, recipient: 'invalid' as Address },
      { ...request, amount: 0n }, { ...request, amount: -1n }, { ...request, amount: 2n ** 256n },
      { ...request, currency: { ...tokenA, decimals: 256 } },
      { ...request, currency: { ...tokenA, address: zeroAddress } },
    ]) await expect(executeTransfer(invalid, f.context)).rejects.toThrow('tradeUnavailable')
    expect(f.read).not.toHaveBeenCalled()
    expect(() => buildTransfer(request, zeroAddress)).toThrow('tradeUnavailable')
  })
  it.each(['account', 'form', 'chain'] as const)('stops a send after the %s changes during the balance lookup', async (change) => {
    const f = fixture()
    let current = f.identity, formCurrent = true
    const read: PublicRpc = async (method, params) => {
      const result = await f.read(method, params)
      if (method === 'eth_call') {
        if (change === 'account') current = { ...current, revision: 2 }
        if (change === 'chain') current = { ...current, chainId: 1 }
        if (change === 'form') formCurrent = false
      }
      return result
    }
    await expect(executeTransfer(request, { ...f.context, read, getIdentity: () => current, isCurrentForm: () => formCurrent })).rejects.toThrow('tradeIdentityChanged')
    expect(f.submitted).toEqual([])
  })
  it('retains a broadcast hash while pending and never resends', async () => {
    const f = fixture()
    await expect(executeTransfer(request, { ...f.context, wait: async () => { throw new TradeError('tradePending') } })).rejects.toThrow('tradePending')
    expect(f.submitted).toHaveLength(1)
    expect(f.events.at(-1)).toMatchObject({ hash, stage: 'tradeConfirming', to: tokenA.address })
  })
  it('blocks when the wallet reports a different account before the final send', async () => {
    const f = fixture(), original = f.identity.provider.request
    f.identity.provider.request = (args) => args.method === 'eth_accounts' ? Promise.resolve([recipient]) : original(args)
    await expect(executeTransfer(request, f.context)).rejects.toThrow('tradeIdentityChanged')
    expect(f.submitted).toEqual([])
  })
  it('blocks a wrong RPC chain before reading a balance', async () => {
    const f = fixture()
    const read = vi.fn<PublicRpc>(async () => '0x1')
    await expect(executeTransfer(request, { ...f.context, read })).rejects.toThrow('tradeUnavailable')
    expect(read).toHaveBeenCalledTimes(1)
    expect(f.submitted).toEqual([])
  })
  it.each(['wrap', 'unwrap'] as const)('keeps %s available when the swap switch is paused', async (direction) => {
    const f = fixture()
    await expect(executeWrap({ direction, amount: 10n }, f.context)).resolves.toBe(hash)
    expect(f.submitted).toHaveLength(1)
    expect(f.submitted[0].to).toBe(WOKB_ADDRESS)
  })
})
