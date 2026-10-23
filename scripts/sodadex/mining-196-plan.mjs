// Isolated, memory-only 196 fork; intentionally no public broadcast transport.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { LoopbackMiningPlan } from './mining-plan-rpc.mjs'

export const LOCAL_RPC = 'http://127.0.0.1:8956'
export class Mining196Plan extends LoopbackMiningPlan {
  constructor(owner, output, feeCap, child) {
    super(owner, output, feeCap)
    this.child = child
  }
  assertOwner() {
    if (!this.child?.pid || this.child.exitCode !== null) throw new Error('Owned Anvil child is not alive')
    process.kill(this.child.pid, 0)
    const listeners = execFileSync('lsof', ['-nP', '-t', '-iTCP:8956', '-sTCP:LISTEN'], { encoding: 'utf8' }).trim().split(/\s+/)
    if (listeners.length !== 1 || Number(listeners[0]) !== this.child.pid) throw new Error('Port 8956 is not exclusively owned by this runner')
  }
  async rpc(method, params = []) {
    this.assertOwner()
    const response = await fetch(LOCAL_RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(120_000) })
    const body = await response.json()
    if (!response.ok || body.id !== 1 || body.jsonrpc !== '2.0' || body.error) {
      if (method === 'eth_call') {
        try {
          const trace = await this.rpc('debug_traceCall', [params[0], params[1] ?? 'latest', { tracer: 'callTracer' }])
          fs.writeFileSync(`${this.output}.failure-trace.json`, JSON.stringify(trace, null, 2))
        } catch {}
      }
      throw new Error(`Owned 196 fork ${method}: ${body.error?.message ?? response.status}`)
    }
    return body.result
  }
  async start() {
    if (await this.rpc('eth_chainId') !== '0xc4' || !/anvil/i.test(await this.rpc('web3_clientVersion'))) throw new Error('Owned 196 Anvil required')
    this.startNonce = BigInt(await this.rpc('eth_getTransactionCount', [this.owner, 'latest']))
    await this.rpc('anvil_impersonateAccount', [this.owner])
    await this.rpc('anvil_setBalance', [this.owner, '0x56bc75e2d63100000'])
    this.save()
  }
  save() {
    fs.writeFileSync(this.output, JSON.stringify({ schemaVersion: 1, chainId: 196, stage: 'test-196', localForkOnly: true,
      broadcast: false, publicChainWrites: 0, owner: this.owner, startNonce: String(this.startNonce), feeCap: String(this.feeCap),
      contracts: this.contracts, stack: this.stack, miners: this.miners, business: this.business, businessPrincipal: this.businessPrincipal,
      failure: this.failure, reuseProof: this.reuseProof, budget: this.budget, fork: this.fork,
      artifacts: this.artifactProof, executionSourceSha256: this.executionSourceSha256, temporarySigner: this.temporarySigner, transactions: this.rows,
    }, null, 2) + '\n')
  }
}
