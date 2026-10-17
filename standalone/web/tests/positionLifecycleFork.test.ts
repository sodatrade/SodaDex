import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { type Address, type Hex } from 'viem'
import { proxyRpc } from '../../worker/src/rpc'
import { executeLiquidity, fullRange, getPosition, listPools, LP_CONTRACTS, prepareLiquidity } from '../src/liquidity'
import type { LiquidityOperation, PublicRpc } from '../src/liquidity/types'
import { nftAbi } from '../src/liquidity/abis'
import { call } from '../src/liquidity/rpc'
import { startLiquidityFork } from './liquidityForkFixture'
const owner = '0x6ecf746b078d46391f8C425B150153212F7C0545' as Address
const recipient = '0x1111111111111111111111111111111111111111' as Address
const fixturePath = process.env.SODADEX_LP_FORK_STATE
let fixture: Awaited<ReturnType<typeof startLiquidityFork>>
const proofs: object[] = []
const read: PublicRpc = async (method, params = []) => {
  const response = await proxyRpc(new Request('https://soda.example/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }), (async (_url, init) => {
    const request = JSON.parse(String(init?.body)); return Response.json({ jsonrpc: '2.0', id: request.id, result: await fixture.request(request.method, request.params) })
  }) as typeof fetch)
  const body = await response.json() as { result?: unknown; error?: unknown }
  if (body.error) throw Error(JSON.stringify(body.error))
  return body.result
}
async function execute(operation: LiquidityOperation, address = owner): Promise<Hex> {
  const identity = { address, chainId: 196, revision: 1, provider: { request: ({ method, params }: { method: string; params?: unknown[] }) =>
    method === 'eth_accounts' ? Promise.resolve([address]) : fixture.request(method, params) } }
  const review = await prepareLiquidity(operation, address, read)
  return executeLiquidity(review, { identity, getIdentity: () => identity, onProgress: () => {}, read })
}
describe.runIf(Boolean(fixturePath))('owned chain-196 position NFT lifecycle', () => {
  beforeAll(async () => {
    fixture = await startLiquidityFork({ fixturePath: fixturePath!, stateViewCodePath: process.env.SODADEX_LP_STATEVIEW_CODE })
    await fixture.request('anvil_setBalance', [recipient, '0x56bc75e2d63100000'])
  }, 20000)
  afterAll(async () => {
    fixture?.stop()
    await mkdir(resolve(process.cwd(), '../../.analysis/nft'), { recursive: true })
    await writeFile(resolve(process.cwd(), '../../.analysis/nft/lifecycle.json'), JSON.stringify({ mode: 'owned-anvil-only', mainnetWrites: 0, proofs }, null, 2))
  })
  it.each(['v3', 'v4'] as const)('%s transfers a funded NFT, rejects premature burn, withdraws and burns the empty token', async protocol => {
    const pool = (await listPools(read)).find(p => p.protocol === protocol)!
    const manager = protocol === 'v3' ? LP_CONTRACTS.v3Manager : LP_CONTRACTS.v4Manager
    const mint = await execute({ kind: 'mint', pool, ...fullRange(pool.tickSpacing), amount0: pool.currency0.native ? 10n ** 14n : 100n, amount1: pool.currency1.native ? 10n ** 14n : 100n })
    const receipt = await fixture.request('eth_getTransactionReceipt', [mint]) as { logs: { address: string; topics: Hex[] }[] }
    const tokenId = BigInt(receipt.logs.find(l => l.address.toLowerCase() === manager.toLowerCase() && l.topics.length === 4 && BigInt(l.topics[1]) === 0n)!.topics[3])
    let position = await getPosition(protocol, tokenId, read)
    await expect(prepareLiquidity({ kind: 'burn', position }, owner, read)).rejects.toMatchObject({ code: 'invalidAmount' })
    const transfer = await execute({ kind: 'transfer', position, recipient })
    position = await getPosition(protocol, tokenId, read)
    expect(position.owner.toLowerCase()).toBe(recipient)
    expect(position.liquidity).toBeGreaterThan(0n)
    await expect(prepareLiquidity({ kind: 'decrease', position, liquidity: position.liquidity }, owner, read)).rejects.toMatchObject({ code: 'notOwner' })
    const remove = await execute({ kind: 'decrease', position, liquidity: position.liquidity }, recipient)
    position = await getPosition(protocol, tokenId, read)
    expect(position.liquidity).toBe(0n)
    expect(position.claimable0 + position.claimable1).toBe(0n)
    const burn = await execute({ kind: 'burn', position }, recipient)
    await expect(call(nftAbi, manager, 'ownerOf', [tokenId], read)).rejects.toThrow()
    const transactions = await Promise.all([mint, transfer, remove, burn].map(async hash => {
      const result = await fixture.request('eth_getTransactionReceipt', [hash]) as { status: Hex; gasUsed: Hex }
      expect(result.status).toBe('0x1'); return { hash, ...result }
    }))
    proofs.push({ protocol, tokenId: tokenId.toString(), recipient, workerGate: true, prematureBurnRejected: true, formerOwnerRejected: true, transactions })
  }, 90000)
})
