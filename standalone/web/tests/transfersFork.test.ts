import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { encodeFunctionData, zeroAddress, type Address, type Hex } from 'viem'
import { KNOWN_CURRENCIES } from '../src/liquidity/config'
import { executeTransfer, erc20TransferAbi } from '../src/trading/transfers'
import type { PublicRpc, TradeIdentity } from '../src/trading/types'
import { startLiquidityFork } from './liquidityForkFixture'
const fixturePath = process.env.SODADEX_LP_FORK_STATE
const owner = '0x6ecf746b078d46391f8C425B150153212F7C0545' as Address
const recipient = '0x1111111111111111111111111111111111111111' as Address
let fixture: Awaited<ReturnType<typeof startLiquidityFork>>, snapshot: unknown
const read: PublicRpc = (method, params) => fixture.request(method, params)
const identity: TradeIdentity = { address: owner, chainId: 196, revision: 1, provider: {
  request: ({ method, params }) => method === 'eth_accounts' ? Promise.resolve([owner]) : fixture.request(method, params),
} }
const context = { identity, getIdentity: () => identity, isCurrentForm: () => true, onProgress: () => {}, read }
describe.runIf(Boolean(fixturePath))('owned local chain-196 wallet sends', () => {
  beforeAll(async () => {
    fixture = await startLiquidityFork({ fixturePath: fixturePath!, stateViewCodePath: process.env.SODADEX_LP_STATEVIEW_CODE })
    snapshot = await fixture.request('evm_snapshot')
  }, 20000)
  beforeEach(async () => {
    expect(await fixture.request('evm_revert', [snapshot])).toBe(true)
    snapshot = await fixture.request('evm_snapshot')
  })
  afterAll(() => fixture?.stop())
  it('sends native OKB and verifies the recipient balance and successful receipt', async () => {
    expect(await read('eth_getCode', [recipient, 'latest'])).toBe('0x')
    const before = BigInt(await read('eth_getBalance', [recipient, 'latest']) as Hex), amount = 10n ** 10n
    const hash = await executeTransfer({ currency: KNOWN_CURRENCIES[0], recipient, amount }, context)
    expect(BigInt(await read('eth_getBalance', [recipient, 'latest']) as Hex) - before).toBe(amount)
    const receipt = await read('eth_getTransactionReceipt', [hash]) as { status: string; from: string; to: string }
    expect(receipt.status).toBe('0x1')
    expect(receipt.to.toLowerCase()).toBe(recipient.toLowerCase())
  }, 20000)
  it('sends an ERC20 directly with no approval and verifies both token balances', async () => {
    const currency = KNOWN_CURRENCIES[2], amount = 1n
    const balance = async (account: Address): Promise<bigint> => BigInt(await read('eth_call', [{ to: currency.address,
      data: encodeFunctionData({ abi: erc20TransferAbi, functionName: 'balanceOf', args: [account] }) }, 'latest']) as Hex)
    const senderBefore = await balance(owner), recipientBefore = await balance(recipient)
    const hashes = new Set<Hex>()
    const hash = await executeTransfer({ currency, recipient, amount }, { ...context, onProgress: (p) => { if (p.hash) hashes.add(p.hash) } })
    expect(hashes.size).toBe(1)
    expect(senderBefore - await balance(owner)).toBe(amount)
    expect(await balance(recipient) - recipientBefore).toBe(amount)
    const receipt = await read('eth_getTransactionReceipt', [hash]) as { status: string; to: string }
    expect(receipt.status).toBe('0x1')
    expect(receipt.to.toLowerCase()).toBe(currency.address.toLowerCase())
  }, 20000)
  it('rejects a missing token balance and a zero recipient without broadcasting', async () => {
    const nonce = await fixture.request('eth_getTransactionCount', [owner, 'latest'])
    await expect(executeTransfer({ currency: KNOWN_CURRENCIES[1], recipient, amount: 1n }, context)).rejects.toThrow('tradeUnavailable')
    await expect(executeTransfer({ currency: KNOWN_CURRENCIES[0], recipient: zeroAddress, amount: 1n }, context)).rejects.toThrow('tradeUnavailable')
    expect(await fixture.request('eth_getTransactionCount', [owner, 'latest'])).toBe(nonce)
  }, 20000)
})
