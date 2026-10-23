import { decodeEventLog, parseAbi, type Address, type Hex } from 'viem'
import type { MiningProductDeployment, MiningProject } from '../../mining-products.ts'
import { assertCanonical, block } from './rpc.ts'
import { Repository } from './repository.ts'
import { hash, quantity, record, same, ServiceError, type Discovery, type Rpc, type RuntimeConfig } from './types.ts'
const events = parseAbi([
  'event TokenCreated(address indexed token,address indexed creator,address indexed quote,uint256 graduation,string metadataURI,address vault,address tracker,uint16 templateId)',
  'event GraduatedV2(address indexed token,address indexed pair,address vault,uint128 quoteInjected,uint128 tokenInjected)',
])
export class Directory {
  constructor(readonly config: RuntimeConfig, readonly d: MiningProductDeployment, readonly repo: Repository, readonly rpc: Rpc, readonly discovery: Discovery) {}
  private save(project: MiningProject): string {
    return this.repo.change(s => {
      const key = project.token.address.toLowerCase()
      if (JSON.stringify(s.projects[key]) !== JSON.stringify(project)) { s.projects[key] = project; s.revision++ }
      return String(s.revision)
    })
  }
  async refresh(token: Address): Promise<MiningProject> {
    if (!this.repo.read().projects[token.toLowerCase()]) throw new ServiceError('project_not_registered', 404)
    const verifiedBase = await this.discovery.verifyBase(this.rpc, this.d, this.config.expectedSigner)
    const project = await this.discovery.resolveProject(this.rpc, this.d, token, this.config.expectedSigner, verifiedBase)
    this.save(project); await this.repo.flush(); return project
  }
  async register(transactionHash: Hex): Promise<{ project: MiningProject; revision: string }> {
    const receipt = await this.rpc.request('eth_getTransactionReceipt', [transactionHash])
    if (!record(receipt) || !hash(receipt.transactionHash) || !same(receipt.transactionHash, transactionHash) || quantity(receipt.status) !== 1n ||
        typeof receipt.blockNumber !== 'string' || !hash(receipt.blockHash) || !Array.isArray(receipt.logs)) throw new ServiceError('successful_receipt_required')
    const b = await block(this.rpc, receipt.blockNumber)
    if (!same(b.hash, receipt.blockHash)) throw new ServiceError('chain_reorg', 503)
    const transaction = await this.rpc.request('eth_getTransactionByHash', [transactionHash])
    if (!record(transaction) || transaction.to !== null && typeof transaction.to !== 'string' ||
        !same(String(transaction.to), this.d.contracts.manager.address) || !same(String(transaction.blockHash), b.hash) ||
        !same(String(transaction.hash), transactionHash)) throw new ServiceError('manager_transaction_required')
    let token: Address | undefined
    for (const log of receipt.logs) {
      if (!record(log) || typeof log.address !== 'string' || !same(log.address, this.d.contracts.manager.address) || typeof log.data !== 'string' || !Array.isArray(log.topics)) continue
      try {
        const e = decodeEventLog({ abi: events, data: log.data as Hex, topics: log.topics as [Hex, ...Hex[]], strict: true })
        if (e.eventName === 'TokenCreated') {
          if (e.args.templateId !== this.d.templateId || !same(e.args.quote, this.d.contracts.fab.address) ||
              !same(e.args.creator, String(transaction.from))) throw new ServiceError('project_event_invalid')
          token = e.args.token
        } else if (this.repo.read().projects[e.args.token.toLowerCase()]) token = e.args.token
      } catch (e) { if (e instanceof ServiceError) throw e }
    }
    if (!token) throw new ServiceError('project_creation_event_required')
    // The old receipt proves origin only. Always save a current, internally pinned
    // project proof so replaying creation cannot remove a later graduation pair.
    const verifiedBase = await this.discovery.verifyBase(this.rpc, this.d, this.config.expectedSigner)
    if (BigInt(verifiedBase.number) < BigInt(b.number)) throw new ServiceError('chain_state_stale', 503)
    const project = await this.discovery.resolveProject(this.rpc, this.d, token, this.config.expectedSigner, verifiedBase)
    await assertCanonical(this.rpc, b)
    const revision = this.save(project)
    this.repo.change(s => {
      for (const c of Object.values(s.challenges)) if (c.authorization && same(c.address, String(transaction.from)) && c.authorization.tx.data.toLowerCase() === String(transaction.input).toLowerCase()) c.status = 'registered'
      s.requested = true
    })
    await this.repo.flush()
    return { project, revision }
  }
}
