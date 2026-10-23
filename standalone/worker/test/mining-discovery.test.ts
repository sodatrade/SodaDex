import { decodeFunctionData, encodeFunctionResult, keccak256, parseAbi, type Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { resolveMiningProject, verifyMiningBase, type MiningDiscoveryRpc } from '../../mining-discovery'
import { IMPLEMENTATION_SLOT } from '../../mining-calls'
import { MINING_PRODUCT_READ_ABI } from '../../mining-abi'
import { parseMiningDeployment, MINING_PRODUCT_ROLES, type MiningAddress, type MiningProductDeployment } from '../../mining-products'

const addr = (n: number): MiningAddress => `0x${n.toString(16).padStart(40, '0')}`
const code = '0x60006000', hash = keccak256(code), signer = addr(999), zero = addr(0)
const abi = parseAbi([...new Set([...Object.values(MINING_PRODUCT_READ_ABI).flat(),
  'function MANAGER() view returns(address)', 'function ROUTER() view returns(address)',
])])
function fixture(options: { change?: (name: string, to: string, value: unknown) => unknown; reorg?: boolean; noPair?: boolean; chain?: string; badCode?: boolean; badSlot?: boolean } = {}): { d: MiningProductDeployment; rpc: MiningDiscoveryRpc } {
  const contracts = Object.fromEntries(MINING_PRODUCT_ROLES.map((role, i) => [role, { address: addr(i + 1), runtimeKeccak256: hash,
    ...(['mining', 'manager', 'nftFactory', 'circuitMarket'].includes(role) ? { implementation: { address: addr(i + 101), runtimeKeccak256: hash } } : {}),
    ...(role === 'circuits' ? { beacon: { address: addr(200), runtimeKeccak256: hash, implementation: { address: addr(201), runtimeKeccak256: hash } } } : {}),
  }]))
  const ident = (n: number): object => ({ address: addr(n), runtimeKeccak256: hash })
  const d = parseMiningDeployment({ schemaVersion: 1, chainId: 1952, state: 'ready', version: 'discovery-test', sourceHistoryVersion: 2,
    genesisBlock: '1', templateId: 0, contracts, projects: [{ symbol: 'TEST-A', token: ident(301), vault: ident(302), holder: ident(303), ...(options.noPair ? {} : { pair: ident(304) }) }] }) as MiningProductDeployment
  const c = d.contracts, p = d.projects[0]
  const values: Record<string, unknown> = {
    signer, QUOTE_SIGNER: signer, POOL_FEE: 0, GRADUATION: 5000n * 100_000_000n, MANAGER: c.manager.address,
    LAUNCH_FACTORY: c.launchFactory.address, REGISTRY: c.registry.address, V2_FACTORY: c.v2Factory.address,
    V2_ROUTER02: c.router.address, factoryOf: c.miningFactory.address, FAB: c.fab.address, FARM: c.farm.address,
    MINING: c.mining.address, MINER_NFT: c.circuits.address, NFT_FACTORY: c.nftFactory.address,
    MARKET: c.circuitMarket.address, ROUTER: c.router.address, WRAPPED_NATIVE: c.wrappedNative.address,
    WETH: c.wrappedNative.address, factory: c.v2Factory.address, rewardHistoryVersion: 2n,
    circuitBeacon: c.circuits.beacon!.address, implementation: c.circuits.beacon!.implementation.address,
    vaultOf: p.vault.address, tracker: p.holder.address, symbol: p.symbol, pairOf: p.pair?.address ?? zero, pair: p.pair?.address ?? zero,
    taxSink: p.vault.address, TOKEN: p.token.address, QUOTE: c.fab.address, registeredVault: true,
    rewardReceiver: p.holder.address, VAULT: p.vault.address, getPair: p.pair?.address ?? zero,
    token0: p.token.address, token1: c.fab.address,
  }
  let blockReads = 0
  const rpc: MiningDiscoveryRpc = { async request(method, params = []) {
    if (method === 'eth_chainId') return options.chain ?? '0x7a0'
    if (method === 'eth_getBlockByNumber') return { number: '0x10', timestamp: '0x100', hash: `0x${(options.reorg && blockReads++ > 0 ? '2' : '1').repeat(64)}` }
    if (method === 'eth_getCode') return options.badCode ? '0x6001' : code
    if (method === 'eth_getStorageAt') {
      expect(params[1]).toBe(IMPLEMENTATION_SLOT)
      const target = Object.values(c).find((v) => v.address === params[0])!
      return `0x${(options.badSlot ? addr(987) : target.implementation!.address).slice(2).padStart(64, '0')}`
    }
    if (method !== 'eth_call') throw new Error(`Unexpected method ${method}`)
    const tx = params[0] as { to: string; data: Hex }, decoded = decodeFunctionData({ abi, data: tx.data }), name = decoded.functionName!
    const value = options.change?.(name, tx.to, values[name]) ?? (name === 'LAUNCH_FACTORY' && tx.to === c.farm.address ? c.miningFactory.address : values[name])
    if (value === undefined) throw new Error(`Unexpected getter ${name}`)
    return encodeFunctionResult({ abi, functionName: name, result: value })
  } }
  return { d, rpc }
}

describe('chain-proven mining project directory', () => {
  it('verifies pinned roots including proxy and NFT beacon implementations', async () => {
    const { d, rpc } = fixture()
    expect((await verifyMiningBase(rpc, d, signer)).number).toBe('0x10')
  })
  it('rejects a backend returning another height for a pinned proof', async () => {
    const { d, rpc } = fixture()
    await expect(verifyMiningBase(rpc, d, signer, '0x11')).rejects.toThrow('wrong_block')
  })
  it.each(['runtime', 'proxy', 'chain', 'signer'] as const)('stops when the trusted %s changes', async (kind) => {
    const { d, rpc } = fixture({ badCode: kind === 'runtime', badSlot: kind === 'proxy', chain: kind === 'chain' ? '0xc4' : undefined,
      change: (name, _to, value) => name === 'signer' && kind === 'signer' ? addr(777) : value })
    await expect(verifyMiningBase(rpc, d, signer)).rejects.toThrow()
  })
  it('discovers a registered project and its canonical graduated pair', async () => {
    const { d, rpc } = fixture()
    expect(await resolveMiningProject(rpc, d, d.projects[0].token.address, signer, {number:'0x10',hash:`0x${'1'.repeat(64)}`,timestamp:256n})).toEqual(d.projects[0])
  })
  it('accepts the pre-graduation project without inventing a pair', async () => {
    const { d, rpc } = fixture({ noPair: true })
    expect((await resolveMiningProject(rpc, d, d.projects[0].token.address, signer, {number:'0x10',hash:`0x${'1'.repeat(64)}`,timestamp:256n})).pair).toBeUndefined()
  })
  it.each(['factory', 'tracker', 'signer', 'pair'] as const)('rejects a forged %s binding', async (kind) => {
    const { d, rpc } = fixture({ change: (name, to, value) =>
      kind === 'factory' && name === 'vaultOf' && to === addr(9) || kind === 'tracker' && name === 'rewardReceiver' ||
      kind === 'signer' && name === 'QUOTE_SIGNER' || kind === 'pair' && name === 'getPair' ? addr(888) : value })
    await expect(resolveMiningProject(rpc, d, d.projects[0].token.address, signer, {number:'0x10',hash:`0x${'1'.repeat(64)}`,timestamp:256n})).rejects.toThrow()
  })
  it('rejects a reorganization between the base and project proofs', async () => {
    const { d, rpc } = fixture()
    const verified = await verifyMiningBase(rpc, d, signer)
    const changed = {request: async (method: string, params: unknown[] = []): Promise<unknown> => method === 'eth_getBlockByNumber' ? {number:'0x10',timestamp:'0x100',hash:`0x${'2'.repeat(64)}`} : rpc.request(method,params)}
    await expect(resolveMiningProject(changed, d, d.projects[0].token.address, signer, verified)).rejects.toThrow('reorg')
  })
  it('does not publish a directory proof across a block reorganization', async () => {
    const { d, rpc } = fixture({ reorg: true })
    await expect(resolveMiningProject(rpc, d, d.projects[0].token.address, signer, {number:'0x10',hash:`0x${'1'.repeat(64)}`,timestamp:256n})).rejects.toThrow('reorg')
  })
})
