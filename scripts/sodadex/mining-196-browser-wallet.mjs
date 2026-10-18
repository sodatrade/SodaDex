// Local, fail-closed request queue. This module deliberately never signs or broadcasts.
// The CLI consumer must validate ABI/business intent and canonical receipts before execution.
import fs from 'node:fs'
import http from 'node:http'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
export const CAP = 2600000000000000n
const NATIVE_CAP = 11000000000n
const KEEPER_CAP = 80000000000000n
const address = /^0x[0-9a-fA-F]{40}$/
const hex = /^0x(?:[0-9a-fA-F]{2})*$/
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const same = (a,b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()
function requireValue(ok, message) { if (!ok) throw new Error(message) }
function uint(value) { requireValue(typeof value === 'string' && /^(0x[0-9a-fA-F]+|[0-9]+)$/.test(value), 'Invalid quantity'); return BigInt(value) }
function persist(file, state) {
  fs.writeFileSync(file+'.tmp', JSON.stringify(state,null,2)+'\n', {mode:0o600})
  fs.renameSync(file+'.tmp',file)
}
export function validateChallenge(message, {origin, deployment, owner, now = Math.floor(Date.now()/1000)}) {
  requireValue(typeof message === 'string' && message.length < 4096, 'Invalid challenge')
  const lines = message.split('\n')
  requireValue(lines.length === 10 && lines[0] === 'SodaDEX 196 test project launch' &&
    lines[1] === `Origin: ${origin}` && lines[2] === 'Chain ID: 196' &&
    lines[3] === `Deployment: ${deployment.version}` && lines[4] === `Address: ${owner.toLowerCase()}`, 'Challenge identity mismatch')
  requireValue(/^Request ID: [a-zA-Z0-9_-]{8,128}$/.test(lines[5]), 'Invalid challenge request ID')
  requireValue(/^Expires at: [0-9]+$/.test(lines[6]), 'Invalid challenge expiry')
  const expires = Number(lines[6].slice(12))
  requireValue(expires > now && expires <= now + 600, 'Challenge expired or excessive lifetime')
  requireValue(/^Name: [^\r\n]{1,80}$/.test(lines[7]) && /^Symbol: [^\r\n]{1,20}$/.test(lines[8]) &&
    /^Metadata URI: [^\r\n]{0,2048}$/.test(lines[9]), 'Invalid challenge form')
  return message
}
export class Mining196BrowserQueue {
  constructor({file, deployment, journal, approval, origin, validateCall = () => false}) {
    requireValue(new URL(origin).origin === origin, 'Exact origin required')
    requireValue(deployment.chainId === 196 && deployment.profileId === '196-mining-test' && deployment.publicDeployment === true && deployment.localOnly === false, 'Public 196 test manifest required')
    requireValue(journal.chainId === 196 && journal.profileId === '196-mining-test' && journal.phase === 'deployment-inventory-complete' &&
      !journal.pending && !journal.failure && journal.transactions.length === 55 && journal.transactions.every(r=>r.status === '0x1'), 'Completed 55-operation public journal required')
    requireValue(approval.approved === true && approval.chainId === 196 && approval.profileId === '196-mining-test' &&
      approval.totalOwnerOutlayCapWei === String(CAP) && approval.planHash === journal.planHash && digest(approval) === digest(journal.approval), 'Exact approval required')
    requireValue(address.test(journal.owner), 'Invalid owner')
    this.validateCall=validateCall; this.file=file; this.owner=journal.owner; this.deployment=deployment; this.origin=origin
    this.binding=digest({deployment,journal,approval,origin})
    this.targets=new Set(Object.values(deployment.contracts).map(c=>c.address.toLowerCase()))
    this.session=randomBytes(32).toString('hex')
    this.state=fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : null
    if (this.state) requireValue(this.state.binding === this.binding, 'Existing ledger binding changed; never reset')
    else {
      fs.closeSync(fs.openSync(file,'wx',0o600))
      this.state={version:1,binding:this.binding,baseGasWei:String(uint(journal.actualFeesWei)),walletGasWei:'0',nativeWei:'0',keeperFundingWei:'0',requests:[]}
      this.save()
    }
    this.checkBudget(0n,0n)
  }
  save() { persist(this.file,this.state) }
  checkBudget(gas, value) {
    requireValue(gas >= 0n && value >= 0n, 'Negative reservation')
    requireValue(uint(this.state.nativeWei)+value <= NATIVE_CAP, 'Native principal cap exceeded')
    requireValue(uint(this.state.keeperFundingWei) <= KEEPER_CAP, 'Keeper funding cap exceeded')
    requireValue(uint(this.state.baseGasWei)+uint(this.state.walletGasWei)+uint(this.state.nativeWei)+uint(this.state.keeperFundingWei)+gas+value <= CAP, 'Total owner outlay cap exceeded')
  }
  enqueue(method, params) {
    requireValue(!this.state.requests.some(r=>['queued','claimed'].includes(r.status)), 'Previous request must be resolved first')
    let intent
    if (method === 'eth_sendTransaction') {
      requireValue(Array.isArray(params) && params.length === 1, 'One transaction required')
      const tx=params[0]
      requireValue(tx && Object.keys(tx).every(k=>['from','to','data','value','chainId'].includes(k)), 'Browser cannot choose nonce or gas')
      requireValue(same(tx.from,this.owner) && address.test(tx.to) && tx.chainId === '0xc4', 'Transaction identity mismatch')
      requireValue(this.targets.has(tx.to.toLowerCase()), 'Target absent from isolated manifest; dynamic projects need verified CLI registration')
      requireValue(typeof tx.data === 'string' && hex.test(tx.data) && tx.data.length >= 10 && tx.data.length <= 100000, 'Contract calldata required')
      requireValue(!['0xa9059cbb','0x23b872dd','0x39509351','0xa22cb465'].includes(tx.data.slice(0,10).toLowerCase()), 'Transfer, blanket approval or incremental approval forbidden')
      if(tx.data.slice(0,10).toLowerCase() === '0x095ea7b3') {
        requireValue(tx.data.length === 138, 'Malformed approval')
        const spender='0x'+tx.data.slice(34,74), amount=BigInt('0x'+tx.data.slice(74))
        requireValue(this.targets.has(spender.toLowerCase()) && amount <= 670000000000n, 'Approval exceeds bounded TEST-FAB allowance')
        requireValue(same(tx.to,this.deployment.contracts.fab.address), 'Only TEST-FAB approval supported')
      }
      const value=uint(tx.value??'0x0')
      this.checkBudget(0n,value)
      requireValue(this.validateCall({from:this.owner,to:tx.to,data:tx.data,value:'0x'+value.toString(16)},this.deployment,true) === true, 'Business calldata validation denied')
      intent={from:this.owner,to:tx.to,data:tx.data,value:String(value),chainId:196}
    } else if(method === 'personal_sign') {
      requireValue(Array.isArray(params) && params.length===2 && same(params[1],this.owner) && hex.test(params[0]), 'Invalid personal_sign parameters')
      const bytes=Buffer.from(params[0].slice(2),'hex'), message=bytes.toString('utf8')
      requireValue(Buffer.from(message).equals(bytes), 'Invalid UTF-8 challenge')
      intent={message:validateChallenge(message,{origin:this.origin,deployment:this.deployment,owner:this.owner})}
    } else throw new Error('Unsupported wallet method')
    const item={id:randomBytes(16).toString('hex'),method,intent,digest:digest({method,intent}),status:'queued',createdAt:Date.now()}
    this.state.requests.push(item); this.save(); return {requestId:item.id,status:item.status}
  }
  // Local CLI may claim only an exact independently reviewed intent; no HTTP route exposes this.
  claimForCli(id, expectedDigest, {gasLimit,gasPrice}) {
    const item=this.state.requests.find(r=>r.id===id)
    requireValue(item?.status === 'queued' && item.digest === expectedDigest, 'Exact queued intent required')
    if(item.method === 'personal_sign') validateChallenge(item.intent.message,{origin:this.origin,deployment:this.deployment,owner:this.owner})
    const gas=uint(gasLimit), price=uint(gasPrice)
    requireValue(price <= 21000000n && (gas > 0n || item.method === 'personal_sign'), 'Gas cap invalid')
    this.checkBudget(gas*price,BigInt(item.intent.value??0))
    item.status='claimed';item.reservedGasWei=String(gas*price);this.save()
    return structuredClone(item)
  }
  // CLI-only; verifier must independently resolve each project from this manager on chain.
  // Never accepts project identities from HTTP or persists unverified dynamic identities.
  async updateProjectsForCli(next, verifyProject) {
    requireValue(next.chainId===196 && next.profileId===this.deployment.profileId && next.version===this.deployment.version &&
      digest(next.contracts)===digest(this.deployment.contracts) && Array.isArray(next.projects), 'Base deployment must not change')
    requireValue(typeof verifyProject==='function','Independent project verifier required')
    for(const project of next.projects) requireValue(await verifyProject(project,next)===true,'Project chain verification failed')
    this.deployment=structuredClone(next)
    this.targets=new Set([...Object.values(next.contracts).map(c=>c.address.toLowerCase()),
      ...next.projects.flatMap(p=>[p.token,p.vault,p.holder,...(p.pair?[p.pair]:[])].map(c=>c.address.toLowerCase()))])
  }
  listPending() { return structuredClone(this.state.requests.filter(r=>['queued','claimed'].includes(r.status))) }
  // Caller MUST first verify the canonical receipt (or recover a personal signature).
  // No network route can reach this method. Unknown broadcasts remain claimed forever.
  resolveFromCli(id, expectedDigest, {result, actualGasWei, nativeWei, keeperFundingWei}) {
    const item=this.state.requests.find(r=>r.id===id)
    requireValue(item?.status === 'claimed' && item.digest === expectedDigest, 'Exact claimed intent required')
    requireValue(typeof result==='string' && (item.method==='personal_sign' ? /^0x[0-9a-fA-F]{130}$/ : /^0x[0-9a-fA-F]{64}$/).test(result), 'Invalid execution result')
    const gas=uint(actualGasWei), native=uint(nativeWei), keeper=uint(keeperFundingWei)
    requireValue(gas>=uint(this.state.walletGasWei) && native>=uint(this.state.nativeWei) && keeper>=uint(this.state.keeperFundingWei), 'Cumulative ledger cannot decrease')
    requireValue(native<=NATIVE_CAP && keeper<=KEEPER_CAP && uint(this.state.baseGasWei)+gas+native+keeper<=CAP, 'Total owner outlay cap exceeded')
    this.state.walletGasWei=String(gas);this.state.nativeWei=String(native);this.state.keeperFundingWei=String(keeper)
    item.status='completed';item.result=result;this.save()
  }
  reject(id) {
    const item=this.state.requests.find(r=>r.id===id)
    requireValue(item?.status === 'queued','Claimed or unknown execution must be reconciled, never replayed')
    item.status='rejected';this.save()
  }
}
// One-use bootstrap token exchanges for a per-process session credential (never a wallet key).
// Header auth avoids cross-site localhost cookie restrictions; exact Origin remains mandatory.
export function createQueueServer(queue) {
  const cookie=randomBytes(32).toString('hex'); let consumed=false
  return http.createServer(async(req,res)=>{
    const respond=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value))}
    try {
      requireValue(req.headers.origin===queue.origin,'Origin denied')
      res.setHeader('Access-Control-Allow-Origin',queue.origin);res.setHeader('Access-Control-Allow-Credentials','true')
      if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Headers','content-type,x-wallet-session');res.setHeader('Access-Control-Allow-Methods','POST');res.writeHead(204);res.end();return}
      requireValue(req.method==='POST','POST required')
      if(req.url==='/session') {
        const token=req.headers['x-wallet-session']??''
        requireValue(!consumed && typeof token==='string' && token.length===queue.session.length && timingSafeEqual(Buffer.from(token),Buffer.from(queue.session)), 'Session denied')
        consumed=true;respond(200,{ready:true,session:cookie});return
      }
      requireValue(req.headers['x-wallet-session']===cookie,'Session required')
      requireValue(req.url==='/queue' || req.url==='/result','Unknown endpoint')
      let body='';for await(const chunk of req){body+=chunk;requireValue(Buffer.byteLength(body)<=110000,'Request too large')}
      const request=JSON.parse(body)
      if(req.url==='/result') {
        const item=queue.state.requests.find(r=>r.id===request.requestId)
        requireValue(item,'Unknown request');respond(200,{requestId:item.id,status:item.status,...(item.result?{result:item.result}:{})});return
      }
      respond(202,queue.enqueue(request.method,request.params))
    } catch(error){respond(400,{error:error.message})}
  })
}
export async function listenLocal(queue, port=0) {
  const server=createQueueServer(queue)
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)})
  return server
}
