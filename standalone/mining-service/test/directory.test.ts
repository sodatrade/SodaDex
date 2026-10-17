import { describe, expect, it, vi } from 'vitest'
import { encodeAbiParameters, encodeEventTopics, parseAbi, parseAbiParameters, type Hex } from 'viem'
import { Directory } from '../src/directory.ts'
import { fixture, d, wallet, header } from './fixture.ts'
const txHash = `0x${'19'.repeat(32)}` as Hex
const event = parseAbi(['event TokenCreated(address indexed token,address indexed creator,address indexed quote,uint256 graduation,string metadataURI,address vault,address tracker,uint16 templateId)'])
function setup() {
  const f = fixture(), p = d.projects[0]
  const log = { address: d.contracts.manager.address, topics: encodeEventTopics({ abi: event, eventName: 'TokenCreated', args: { token: p.token.address, creator: wallet.address, quote: d.contracts.fab.address } }),
    data: encodeAbiParameters(parseAbiParameters('uint256,string,address,address,uint16'), [5000n * 100_000_000n, '', p.vault.address, p.holder.address, d.templateId]) }
  f.rpc.receipts.set(txHash, { transactionHash: txHash, status: '0x1', blockNumber: header.number, blockHash: header.hash, logs: [log] })
  f.rpc.transactions.set(txHash, { hash: txHash, blockHash: header.hash, to: d.contracts.manager.address, from: wallet.address, input: '0x1234' })
  return { ...f, p, log, directory: new Directory(f.c, d, f.repo, f.rpc, f.discovery) }
}
describe('receipt-verified public project directory', () => {
  it('registers only a successful canonical fixed Manager event joined to verified chain mappings', async () => {
    const f = setup(), result = await f.directory.register(txHash)
    expect(result.project).toEqual(f.p); expect(result.revision).toBe('0')
    expect(f.repo.read().requested).toBe(true)
    expect(await f.directory.register(txHash)).toEqual(result)
  })
  it.each(['reverted', 'wrong_manager_event', 'wrong_manager_tx', 'noncanonical', 'missing_event', 'forged_project'])(
    'rejects an invalid registration: %s', async kind => {
      const f = setup(), receipt = f.rpc.receipts.get(txHash) as Record<string, unknown>
      if (kind === 'reverted') receipt.status = '0x0'
      if (kind === 'wrong_manager_event') receipt.logs = [{ ...f.log, address: wallet.address }]
      if (kind === 'wrong_manager_tx') f.rpc.transactions.set(txHash, { hash: txHash, blockHash: header.hash, to: wallet.address })
      if (kind === 'noncanonical') receipt.blockHash = `0x${'77'.repeat(32)}`
      if (kind === 'missing_event') receipt.logs = []
      const source = { ...f.discovery, resolveProject: vi.fn(async () => { throw new Error('chain mappings disagree') }) }
      const directory = kind === 'forged_project' ? new Directory(f.c, d, f.repo, f.rpc, source) : f.directory
      const before = f.repo.read()
      await expect(directory.register(txHash)).rejects.toThrow()
      expect(f.repo.read().projects).toEqual(before.projects); expect(f.repo.read().revision).toBe(before.revision)
    },
  )
  it('refreshes only previously registered addresses and never saves a failed/stale chain verification', async () => {
    const f = setup(), resolve = vi.fn(async () => { throw new Error('verification stale') })
    const dir = new Directory(f.c, d, f.repo, f.rpc, { ...f.discovery, resolveProject: resolve })
    await expect(dir.refresh(wallet.address)).rejects.toThrow('project_not_registered'); expect(resolve).not.toHaveBeenCalled()
    await expect(dir.refresh(f.p.token.address)).rejects.toThrow('verification stale')
    expect(f.repo.read().revision).toBe(0)
  })
})

describe('directory keeps current graduation state', () => {
  it('registers creation, refreshes graduation, then replays old creation without deleting the current pair', async () => {
    const f = setup(), curve = { ...f.p, pair: undefined }
    let current: typeof f.p = curve
    const proof = vi.fn(async () => current)
    const directory = new Directory(f.c, d, f.repo, f.rpc, { ...f.discovery, resolveProject: proof })
    await directory.register(txHash)
    expect(f.repo.read().projects[f.p.token.address.toLowerCase()].pair).toBeUndefined()
    current = f.p; await directory.refresh(f.p.token.address)
    expect(f.repo.read().projects[f.p.token.address.toLowerCase()].pair).toEqual(f.p.pair)
    await directory.register(txHash)
    expect(f.repo.read().projects[f.p.token.address.toLowerCase()].pair).toEqual(f.p.pair)
    expect(proof.mock.calls).toHaveLength(3)
  })
})
