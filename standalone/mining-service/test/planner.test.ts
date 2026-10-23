import { describe, expect, it, vi } from 'vitest'
import { decodeFunctionData, parseAbi } from 'viem'
import { MINING_PRODUCT_WRITE_ABI } from '../../mining-abi.ts'
import { Planner } from '../src/planner.ts'
import { fixture, signer, d, now, wallet } from './fixture.ts'
function setup() {
  const f = fixture(); f.c.expectedSigner = signer.address
  f.repo.change(s => { s.cursor = d.projects.length })
  const sign = vi.fn(signer.signTypedData)
  const planner = new Planner(f.c, d, f.repo, f.rpc, f.discovery, { ...signer, signTypedData: sign }, () => now)
  f.rpc.set('listingView', [wallet.address, d.contracts.circuits.address, 7n, 100n, 0, true])
  f.rpc.set('ownerOf', wallet.address); f.rpc.set('getApproved', d.contracts.circuitMarket.address)
  f.rpc.set('getAmountsIn', [1000n, 100n]); f.rpc.set('getAmountsOut', [990n, 1000n])
  return { ...f, planner, sign }
}
describe('approved fixed business plans', () => {
  it('buys only approved owner inventory with slippage bounded FAB and exact EIP712 contract digest', async () => {
    const f = setup(), result = await f.planner.next()
    expect(result?.kind).toBe('purchase'); expect(result?.to).toBe(d.contracts.farm.address)
    const decoded = decodeFunctionData({ abi: parseAbi(MINING_PRODUCT_WRITE_ABI.farm), data: result!.data })
    expect(decoded.functionName).toBe('buyMiner')
    const p = decoded.args![0] as { listingId: bigint; minerId: bigint; nativePrice: bigint; maxFab: bigint; nonce: bigint; deadline: bigint }
    expect(p).toMatchObject({ listingId: 99n, minerId: 7n, nativePrice: 100n, maxFab: 1005n, deadline: 1060n })
    expect(f.sign).toHaveBeenCalledTimes(1); expect(f.repo.read().authorizations[`purchase:${d.contracts.farm.address.toLowerCase()}`].nonce).toBe(String(p.nonce))
    f.repo.change(s => { s.cursor = d.projects.length })
    await expect(f.planner.next()).rejects.toThrow('authorization_pending')
    expect(f.sign).toHaveBeenCalledTimes(1)
  })
  it.each(['cancelled', 'changed_price', 'wrong_seller', 'wrong_collection', 'owner_changed', 'approval_removed', 'disqualified', 'full', 'no_inventory', 'budget'])(
    'does not sign an invalid purchase: %s', async state => {
      const f = setup()
      if (state === 'cancelled') f.rpc.set('listingView', [wallet.address, d.contracts.circuits.address, 7n, 100n, 0, false])
      if (state === 'changed_price') f.rpc.set('listingView', [wallet.address, d.contracts.circuits.address, 7n, f.c.policy!.maxMinerPriceWei + 1n, 0, true])
      if (state === 'wrong_seller') f.rpc.set('listingView', [signer.address, d.contracts.circuits.address, 7n, 100n, 0, true])
      if (state === 'wrong_collection') f.rpc.set('listingView', [wallet.address, d.contracts.fab.address, 7n, 100n, 0, true])
      if (state === 'owner_changed') f.rpc.set('ownerOf', signer.address)
      if (state === 'approval_removed') { f.rpc.set('getApproved', signer.address); f.rpc.set('isApprovedForAll', false) }
      if (state === 'disqualified') f.rpc.set('admissibleMiner', false)
      if (state === 'full') f.rpc.set('minerCount', 4n)
      if (state === 'no_inventory') f.c.policy!.allowedListingIds = []
      if (state === 'budget') f.c.policy!.maxProcurementFabRaw = 1004n
      expect(await f.planner.next()).toBeUndefined(); expect(f.sign).not.toHaveBeenCalled()
      expect(f.repo.read().jobs['farm:purchase'].status).toBe('waiting')
    },
  )
  it('tax conversion deducts 1% input transfer tax then slippage; clamps input by explicit batch cap', async () => {
    const f = setup(), p = d.projects[0]
    f.repo.change(s => { s.cursor = 0 }); f.c.policy!.maxConversionInputRaw = 1000n; f.rpc.set('balanceOf', 2000n, p.token.address)
    const result = await f.planner.next()
    expect(result?.kind).toBe('conversion'); expect(result?.to).toBe(p.vault.address)
    const decoded = decodeFunctionData({ abi: parseAbi(MINING_PRODUCT_WRITE_ABI.projectVault), data: result!.data })
    const params = decoded.args![0] as { input: bigint; minimumFab: bigint; deadline: bigint }
    expect(params).toMatchObject({ input: 1000n, minimumFab: 995n, deadline: 1060n })
    const quote = f.rpc.calls.find(call => call.method === 'eth_call' && String((call.params[0] as { data: string }).data).startsWith('0xd06ca61f'))
    expect(quote).toBeDefined(); expect(f.sign).toHaveBeenCalledTimes(1)
  })
  it('does not subtract transfer tax for an exempt vault and rejects unexpected tax policy', async () => {
    const f = setup(), p = d.projects[0]
    f.repo.change(s => { s.cursor = 0 }); f.rpc.set('balanceOf', 1000n, p.token.address); f.rpc.set('taxExempt', true); f.rpc.set('getAmountsOut', [1000n, 1000n])
    expect((await f.planner.next())?.kind).toBe('conversion')
    const fresh = setup(); fresh.repo.change(s => { s.cursor = 0 }); fresh.rpc.set('balanceOf', 1000n, p.token.address); fresh.rpc.set('taxSellBps', 200)
    await expect(fresh.planner.next()).rejects.toThrow('token_tax_policy_changed'); expect(fresh.sign).not.toHaveBeenCalled()
  })
  it('syncs tax FAB, catches up bounded farm history, then funds only the fixed vault/farm path', async () => {
    const f = setup(), p = d.projects[0]
    f.repo.change(s => { s.cursor = 0 }); f.rpc.set('balanceOf', 20n, d.contracts.fab.address)
    expect((await f.planner.next())?.kind).toBe('sync')
    f.repo.change(s => { s.cursor = 0 }); f.rpc.set('balanceOf', 0n, d.contracts.fab.address); f.rpc.set('farmPending', 10n)
    f.rpc.set('incomeBatchCount', 100n)
    const history = await f.planner.next()
    expect(history?.to).toBe(d.contracts.farm.address)
    expect(decodeFunctionData({ abi: parseAbi(MINING_PRODUCT_WRITE_ABI.farm), data: history!.data }).functionName).toBe('syncVault')
    f.repo.change(s => { s.cursor = 0 }); f.rpc.set('vaultBatchCursor', 100n)
    const fund = await f.planner.next(); expect(fund?.kind).toBe('fund'); expect(fund?.to).toBe(p.vault.address)
    expect(f.sign).not.toHaveBeenCalled()
  })
  it('uses waiting status without a signed or executable transaction when no tax or stock exists', async () => {
    const f = setup(); f.c.policy!.allowedListingIds = []
    expect(await f.planner.next()).toBeUndefined(); expect(await f.planner.next()).toBeUndefined(); expect(f.sign).not.toHaveBeenCalled()
    expect(Object.values(f.repo.read().jobs).map(j => j.reason)).toEqual(['no_approved_inventory', 'no_tax'])
  })
})


describe('bounded round-robin scheduling', () => {
  it('does not scan the farm after a quiet project and advances to it on the next alarm', async () => {
    const f = setup(); f.repo.change(s => { s.cursor = 0 })
    expect(await f.planner.next()).toBeUndefined()
    expect(f.rpc.calls.some(c => c.method === 'eth_call' && String((c.params[0] as { data: string }).data).startsWith('0x'))).toBe(true)
    expect(f.repo.read().jobs['farm:purchase']).toBeUndefined()
    expect(f.repo.read().cursor).toBe(1)
    expect((await f.planner.next())?.kind).toBe('purchase')
    expect(f.repo.read().cursor).toBe(0)
  })
  it('advances after one project failure so another candidate can make progress', async () => {
    const f = setup(); f.repo.change(s => { s.cursor = 0 })
    vi.spyOn(f.discovery, 'resolveProject').mockRejectedValueOnce(new Error('project_temporarily_unavailable'))
    await expect(f.planner.next()).rejects.toThrow('project_temporarily_unavailable')
    expect(f.repo.read().cursor).toBe(1)
    expect((await f.planner.next())?.kind).toBe('purchase')
    vi.restoreAllMocks()
  })
})
