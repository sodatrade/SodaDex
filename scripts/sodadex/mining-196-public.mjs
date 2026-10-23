import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { PublicMiningExecution } from './mining-public-execution.mjs'
import { fileSha } from './mining-plan-artifacts.mjs'
import { persistentMining196Signer } from './mining-196-signer.mjs'

const RPC = 'https://rpc.ignix.bot/rpc/196'
const READS = new Set(['eth_chainId','web3_clientVersion','eth_blockNumber','eth_getBlockByNumber','eth_getCode','eth_getStorageAt','eth_getTransactionCount','eth_call','eth_estimateGas','eth_gasPrice','eth_getBalance','eth_getTransactionReceipt'])
export const TOTAL_CAP = 2600000000000000n
// Reserve the funded keeper's residual, funding transaction and approved native principal.
// The six measured keeper executions already occur in the rehearsal gas total.
export const GAS_CAP = TOTAL_CAP - 11000000000n - 441000000000n - (80000000000000n - 70675227000000n)
export class PublicMining196 extends PublicMiningExecution {
  constructor({ root, output, rehearsal, resolveArtifact, approval }) {
    super(rehearsal.owner, output, rehearsal, {}, { phaseBudget: { gasWei: String(GAS_CAP) } })
    this.root = root; this.chainId = 196; this.resolveArtifact = resolveArtifact; this.approval = approval
    this.planHash = fileSha(JSON.stringify(rehearsal)); this.phase = 'deployment-and-inventory'
  }
  async rpc(method, params = []) {
    if (!READS.has(method) && method !== 'eth_sendRawTransaction') throw new Error('196 public RPC method is not allowed')
    for (let i = 0; i < (READS.has(method) ? 3 : 1); i++) {
      try {
        const pending = params.includes('pending')
        const operations = pending ? [['eth_chainId',[]],['eth_getBlockByNumber',['latest',false]],
          ['eth_getBlockByNumber',['pending',false]],['eth_getTransactionCount',[this.owner,'latest']],
          ['eth_getTransactionCount',[this.owner,'pending']],[method,params]] : [[method,params]]
        const request = pending ? operations.map(([method,params],id)=>({jsonrpc:'2.0',id,method,params})) : {jsonrpc:'2.0',id:196,method,params}
        const response = await fetch(RPC, { method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify(request),signal:AbortSignal.timeout(20000) })
        if (!response.ok) throw new Error(`Public 196 transport ${response.status}`)
        const body = await response.json()
        let value = body
        if (pending) {
          if (!Array.isArray(body) || body.length !== operations.length) throw new Error('Invalid pending snapshot batch')
          const map = new Map(body.map(x=>[x.id,x]))
          if (map.size !== operations.length || operations.some((_,id)=>map.get(id)?.jsonrpc !== '2.0' || map.get(id)?.error)) throw new Error('Pending snapshot batch failed')
          const [chain,latest,next,mined,queued] = [0,1,2,3,4].map(id=>map.get(id).result)
          if(chain !== '0xc4' || BigInt(next.number)<BigInt(latest.number) || BigInt(next.timestamp)<BigInt(latest.timestamp) || BigInt(mined)!==BigInt(queued)) throw new Error('Stale pending view or unconfirmed owner transaction')
          value={...map.get(5),id:196}
        }
        if (value.id !== 196 || value.jsonrpc !== '2.0' || value.error) throw new Error(`Public 196 ${method}: ${value.error?.message ?? 'invalid response'}`)
        return value.result
      } catch (error) { if (!READS.has(method) || i === 2) throw error }
    }
  }
  async start() {
    const p = this.rehearsal, a = this.approval
    if (a?.chainId !== 196 || a.profileId !== '196-mining-test' || a.approved !== true || a.totalOwnerOutlayCapWei !== String(TOTAL_CAP) ||
        a.planHash !== this.planHash || p.chainId !== 196 || !p.localForkOnly || p.broadcast !== false || p.failure ||
        p.business?.completed !== true || p.transactions.length !== 109 || p.transactions.some(r => r.status !== '0x1') ||
        p.temporarySigner?.memoryOnly !== false || p.temporarySigner.replacementAndFullRehearsalRequiredBeforePublicBroadcast !== false ||
        BigInt(p.budget.requiredGasAndPrincipalWei) > GAS_CAP + 11000000000n || this.feeCap > 21000000n)
      throw new Error('Approved exact 196 persistent-signer rehearsal required')
    if (fs.existsSync(this.output)) throw new Error('Existing public journal: reconcile it; never replay automatically')
    if (!a.executionSourceSha256 || Object.keys(a.executionSourceSha256).length < 5) throw new Error('Public executor source approval missing')
    for (const [file, hash] of Object.entries(a.executionSourceSha256)) {
      if (!/^[a-z0-9-]+\.mjs$/.test(file) || fileSha(fs.readFileSync(path.join(this.root,'scripts/sodadex',file))) !== hash) throw new Error('Approved public execution source changed')
    }
    for (const [file, hash] of Object.entries(p.executionSourceSha256)) {
      if (fileSha(fs.readFileSync(path.join(this.root,'scripts/sodadex',file))) !== hash) throw new Error(`Rehearsal source changed: ${file}`)
    }
    if (persistentMining196Signer().address.toLowerCase() !== p.stack.signer.toLowerCase()) throw new Error('Final signing identity changed')
    if (await this.rpc('eth_chainId') !== '0xc4' || /anvil|hardhat/i.test(await this.rpc('web3_clientVersion'))) throw new Error('Public 196 required')
    this.startNonce = BigInt(await this.rpc('eth_getTransactionCount',[this.owner,'latest']))
    if (this.startNonce !== BigInt(p.startNonce) || BigInt(await this.rpc('eth_getTransactionCount',[this.owner,'pending'])) !== this.startNonce) throw new Error('Owner nonce changed; rehearse again')
    for (const role of Object.values(p.reuseProof)) {
      const code = await this.rpc('eth_getCode',[role.address,'latest'])
      if (fileSha(Buffer.from(code.slice(2),'hex')) !== role.runtimeSha256) throw new Error('Reused runtime changed')
    }
    await this.checkFeeModel(0n,0n)
    this.startBalance = BigInt(await this.rpc('eth_getBalance',[this.owner,'latest']))
    if (this.startBalance < TOTAL_CAP) throw new Error('Owner cannot cover approved total')
    fs.closeSync(fs.openSync(this.output,'wx',0o600)); this.journalOwned = true; this.save()
  }
  save() {
    if (!this.journalOwned) throw new Error('Public journal is not owned')
    const value = { schemaVersion:1,chainId:196,profileId:'196-mining-test',publicTestContracts:true,productionTouched:false,
      approval:this.approval,planHash:this.planHash,phase:this.phase,owner:this.owner,startNonce:String(this.startNonce),
      startBalanceWei:String(this.startBalance),feeCap:String(this.feeCap),actualFeesWei:String(this.actualFees),
      transactions:this.rows,pending:this.pending??null,contracts:this.contracts,stack:this.stack,miners:this.miners,failure:this.failure }
    fs.writeFileSync(this.output+'.tmp',JSON.stringify(value,null,2)+'\n',{mode:0o600}); fs.renameSync(this.output+'.tmp',this.output)
  }
  async signIntent({nonce,gas,value,to,data}) {
    if (this.rows.length >= 55 || value !== 0n) throw new Error('This executor only permits the first 55 zero-native deployment/inventory operations')
    const folder=path.join(os.homedir(),'.local/share/sodadex/wallets/xlayer-test-owner')
    const raw=execFileSync('cast',['mktx','--rpc-url',RPC,'--chain','196','--legacy','--nonce',String(nonce),'--gas-limit',String(gas),
      '--gas-price',String(this.feeCap),'--value','0','--keystore',path.join(folder,'owner'),'--password-file',path.join(folder,'password'),
      ...(to?[to,data]:['--create',data])],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
    return raw
  }
}
