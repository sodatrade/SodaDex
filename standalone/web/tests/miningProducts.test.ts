import { describe, expect, it, vi } from 'vitest'
import { decodeFunctionData, parseAbi } from 'viem'
import { MINING_PRODUCT_WRITE_ABI } from '../../mining-abi'
import { validMiningProductCall } from '../../mining-calls'
import { parseMiningDeployment } from '../../mining-products'
import { buildMiningPlan } from '../src/mining/plans'
import { curveOutput, minimumMiningAmount, taxedV2Output } from '../src/mining/quotes'
import { verifyMiningDeployment } from '../src/mining/protocol'
import { miningTestDeployment, miningTestRpc, MINING_TEST_ACCOUNT } from './fixtures/miningProducts'

describe('1952 product bindings and canonical calls', () => {
  it('requires each proxy and beacon implementation, unique addresses and chain 1952', () => {
    const d = miningTestDeployment()
    expect(parseMiningDeployment(d)).toEqual(d)
    expect(() => parseMiningDeployment({ ...d, chainId: 196 })).toThrow()
    expect(() => parseMiningDeployment({ ...d, contracts: { ...d.contracts, manager: d.contracts.fab } })).toThrow()
    expect(() => parseMiningDeployment({ ...d, contracts: { ...d.contracts, circuits: { ...d.contracts.circuits, beacon: undefined } } })).toThrow()
  })
  it('checks the actual implementation slot and beacon getter, then all fixed bindings', async () => {
    const d = miningTestDeployment(), read = miningTestRpc(d)
    await expect(verifyMiningDeployment(read, d)).resolves.toBeUndefined()
    await expect(verifyMiningDeployment(miningTestRpc(d, (name) => name === 'REWARD_HISTORY' ? d.contracts.manager.address : undefined), d)).rejects.toThrow('miningVersionChanged')
    const changed = vi.fn(read).mockImplementation(async (method, params) => method === 'eth_getStorageAt' ? `0x${'0'.repeat(64)}` : read(method, params))
    await expect(verifyMiningDeployment(changed, d)).rejects.toThrow('miningVersionChanged')
  })
  it('allows a funded bounded swap and rejects altered receiver, appended bytes and state overrides', async () => {
    const d = miningTestDeployment(), read = miningTestRpc(d, (name) => name === 'quoteExactIn' ? 100_000_000n : undefined)
    const plan = await buildMiningPlan({ deployment: d, read, account: MINING_TEST_ACCOUNT, action: 'fragmentBuy', amount: '0.001', slippageBps: 50 })
    for (const { tx } of plan.calls) expect(validMiningProductCall(tx, d, true)).toBe(true)
    const tx = plan.calls.at(-1)!.tx
    expect(validMiningProductCall({ ...tx, data: `${tx.data}00` }, d, true)).toBe(false)
    expect(validMiningProductCall({ ...tx, stateOverride: {} }, d, true)).toBe(false)
    expect(validMiningProductCall({ ...tx, value: '0x1' }, d, true)).toBe(false)
  })
})

describe('1952 executable amounts', () => {
  it('binds native TEST-OKB value to the fixed FAB route and rejects another receiver', async () => {
    const d = miningTestDeployment(), read = miningTestRpc(d, (name) => name === 'getAmountsOut' ? [10n ** 12n, 100_000n] : undefined)
    const plan = await buildMiningPlan({ deployment: d, read, account: MINING_TEST_ACCOUNT, action: 'getTestFab', amount: '0.000001', slippageBps: 50 })
    const tx = plan.calls[0].tx
    expect(plan.calls).toHaveLength(1)
    expect(BigInt(tx.value)).toBe(10n ** 12n)
    expect(validMiningProductCall(tx, d, true)).toBe(true)
    expect(validMiningProductCall({ ...tx, value: '0x0' }, d, true)).toBe(false)
    expect(plan.details.at(-1)?.value).toBe('0.000995 TEST-FAB')
  })
  it('routes a retail miner purchase through the atomic eligibility guard with exact NFT and price', async () => {
    const d = miningTestDeployment(), seller = d.contracts.fab.address
    const read = miningTestRpc(d, (name) => name === 'listingView' ? [seller, d.contracts.circuits.address, 7n, 100n, 0, true]
      : name === 'admissibleMiner' ? true : undefined)
    const plan = await buildMiningPlan({ deployment: d, read, account: MINING_TEST_ACCOUNT, action: 'buyMiner', amount: '2', slippageBps: 50 })
    const tx = plan.calls[0].tx
    expect(tx.to).toBe(d.contracts.minerBuyer.address)
    expect(decodeFunctionData({ abi: parseAbi(MINING_PRODUCT_WRITE_ABI.minerBuyer), data: tx.data }).args).toEqual([2n, 7n, 100n])
    expect(validMiningProductCall(tx, d, true)).toBe(true)
    expect(validMiningProductCall({ ...tx, value: '0x63' }, d, true)).toBe(false)
    await expect(buildMiningPlan({ deployment: d, read: miningTestRpc(d, (name) => name === 'listingView'
      ? [MINING_TEST_ACCOUNT, d.contracts.circuits.address, 7n, 100n, 0, true] : undefined),
    account: MINING_TEST_ACCOUNT, action: 'buyMiner', amount: '2', slippageBps: 50 })).rejects.toThrow('miningInvalidMiner')
  })
  it('allows the actual taxed V2 route during the protection window', async () => {
    const d = miningTestDeployment(), read = miningTestRpc(d, (name) => name === 'protectionActive' ? true : name === 'getReserves'
      ? [1000n * 10n ** 18n, 1000n * 10n ** 8n, 1] : name === 'token0' ? d.projects[0].token.address
      : name === 'taxExempt' ? false : name === 'taxBuyBps' ? 100 : undefined)
    const plan = await buildMiningPlan({ deployment: d, read, project: d.projects[0], account: MINING_TEST_ACCOUNT,
      action: 'projectBuy', amount: '0.001', slippageBps: 50 })
    expect(plan.calls.at(-1)!.tx.to).toBe(d.contracts.router.address)
    expect(validMiningProductCall(plan.calls.at(-1)!.tx, d, true)).toBe(true)
  })
  it('does not demand more fragments than the NFT redemption actually burns', async () => {
    const d = miningTestDeployment(), read = miningTestRpc(d, (name) => name === 'previewRedeem' || name === 'balanceOf' ? 6000n : undefined)
    const plan = await buildMiningPlan({ deployment: d, read, account: MINING_TEST_ACCOUNT, action: 'redeemMiner', amount: '7', slippageBps: 50 })
    const decoded = decodeFunctionData({ abi: parseAbi(MINING_PRODUCT_WRITE_ABI.fragmentVault), data: plan.calls[0].tx.data })
    expect(decoded.args).toEqual([7n, 6000n])
    expect(plan.calls).toHaveLength(1)
  })
  it('authorizes only actual fragment LP inputs while project helper remains full-desired', async () => {
    const d = miningTestDeployment(), read = miningTestRpc(d, (name) => name === 'reserveShares' ? 100n * 10n ** 18n : name === 'reserveFab' ? 100n * 10n ** 8n
      : name === 'balanceOf' ? 10n ** 18n : undefined)
    const plan = await buildMiningPlan({ deployment: d, read, account: MINING_TEST_ACCOUNT, action: 'fragmentAdd', amount: '1', secondAmount: '999', slippageBps: 250 })
    const decoded = decodeFunctionData({ abi: parseAbi(MINING_PRODUCT_WRITE_ABI.fragmentPool), data: plan.calls.at(-1)!.tx.data })
    expect(decoded.args?.slice(0, 2)).toEqual([10n ** 18n, 10n ** 8n])
  })
  it('stops a full vault before any approval plan and rejects excessive burn', async () => {
    const d = miningTestDeployment()
    await expect(buildMiningPlan({ deployment: d, read: miningTestRpc(d, (name) => name === 'minerCount' ? 4n : name === 'MAX_MINERS' ? 4 : undefined),
      account: MINING_TEST_ACCOUNT, action: 'depositMiner', amount: '7', slippageBps: 50 })).rejects.toThrow('miningMinerCapacity')
    await expect(buildMiningPlan({ deployment: d, project: d.projects[0], read: miningTestRpc(d, (name) => name === 'unlocked' ? true : name === 'excluded' ? false
      : name === 'balanceOf' ? 100n * 10n ** 18n : ['activeCredit', 'expiryCursor', 'burnCreditCount'].includes(name) ? 0n : undefined),
      account: MINING_TEST_ACCOUNT, action: 'burnBoost', amount: '60', slippageBps: 50 })).rejects.toThrow('miningBurnLimit')
  })
  it('keeps integer curve cap, separate sale fee rounding and net V2 transfer taxes', () => {
    const s = { buyFee: 100n, sellFee: 100n, buyTax: 100n, sellTax: 100n, snipe: 0n, vQuote: 1000n, vToken: 10000n, sold: 1000n, sellable: 1100n }
    expect(curveOutput(s, true, 10000n)).toBe(100n)
    expect(curveOutput(s, false, 100n)).toBe(9n)
    const buyGross = 1000n * 997n * 100000n / (10000n * 1000n + 1000n * 997n)
    expect(taxedV2Output(1000n, 10000n, 100000n, true, 100n)).toBe(buyGross - buyGross / 100n)
    expect(minimumMiningAmount(1000n, 50)).toBe(995n)
    expect(() => minimumMiningAmount(1n, 50)).toThrow()
  })
})
