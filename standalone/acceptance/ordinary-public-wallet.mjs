// Exact approved TEST acceptance. The browser receives hashes, never keys or raw signatures.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { assertAcceptanceBudget, assertAcceptanceProgress, assertNextIntent } from './ordinary-intent.mjs'
import { assertContinuation, assertJournalTotals, assertRetainedPrefix } from './ordinary-continuation.mjs'
import { assertMiningFeeParameters } from '../../scripts/sodadex/mining-fee-model.mjs'
const require=createRequire(new URL('../web/package.json',import.meta.url)),v=require('viem')
const root=path.resolve(import.meta.dirname,'../..'),dir=path.join(root,'deployments/xlayer-test/ordinary-pools')
const config=JSON.parse(fs.readFileSync(path.join(root,'deployments/xlayer-test/active.json')))
const approval=JSON.parse(fs.readFileSync(dir+'/public-approval.json'))
const planText=fs.readFileSync(dir+'/final-rehearsal.json'),basePlan=JSON.parse(planText),owner=basePlan.owner
let plan=basePlan
const sha=x=>createHash('sha256').update(x).digest('hex'),json=x=>JSON.stringify(x,(_,y)=>typeof y==='bigint'?String(y):y,2)+'\n'
if(!approval.approved||approval.chainId!==196||approval.production!==false||approval.totalCapWei!=='320000000000000'||approval.gasCapWei!=='317900000000000'||approval.nonGasCapWei!=='2100000000000'||approval.maxGasPriceWei!=='30000000'||approval.maxTestTokenApprovalsRaw!=='20000000000'||approval.planSha256!==sha(planText)||basePlan.chainId!==196||basePlan.publicChainWrites!==0||owner.toLowerCase()!==config.owner.toLowerCase()||basePlan.rows.length>28)throw Error('Exact approved final rehearsal required')
const rpc=config.rpcUrl,p=v.createPublicClient({transport:v.http(rpc,{timeout:30000,retryCount:1})})
const file=dir+'/public-journal.json',lock=file+'.lock',token='0x842b7bf61f2cb4be8aacac6adece3244c2a6f6ab'
const load=()=>{
 const state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{chainId:196,owner,planSha256:approval.planSha256,approvalSha256:sha(fs.readFileSync(dir+'/public-approval.json')),productionTouched:false,rows:[],gasSpentWei:'0',nonGasSpentWei:'0',fabSpentRaw:'0',pending:null,completed:false}
 if(state.planSha256!==approval.planSha256||state.approvalSha256!==sha(fs.readFileSync(dir+'/public-approval.json'))||state.chainId!==196||!same(state.owner,owner)||state.productionTouched!==false)throw Error('Journal belongs to another plan or approval')
 assertJournalTotals(state)
 if(state.continuationSha256){
  const recovery=readContinuation();assertRetainedPrefix(state,recovery.baseline,recovery.hash);plan=recovery.plan
 }
 return state
}
function readContinuation(){
 const text=fs.readFileSync(dir+'/continuation.json'), continuation=JSON.parse(text),baselineText=fs.readFileSync(dir+'/public-journal-before-continuation.json'),childText=fs.readFileSync(dir+'/remaining-rehearsal.json')
 const baseline=JSON.parse(baselineText),child=JSON.parse(childText)
 const effective=assertContinuation(basePlan,child,baseline,continuation,{base:sha(planText),approval:sha(fs.readFileSync(dir+'/public-approval.json')),baseline:sha(baselineText),child:sha(childText)},config.permit2,approval)
 return {baseline,plan:effective,hash:sha(text),baselineHash:sha(baselineText)}
}
const save=s=>{fs.writeFileSync(file+'.tmp',json(s));fs.renameSync(file+'.tmp',file)}
const same=(a,b)=>a?.toLowerCase()===b?.toLowerCase()
async function bindings(){
 if(await p.getChainId()!==196)throw Error('Wrong public chain')
 const originals=JSON.parse(fs.readFileSync(path.join(root,'deployments/xlayer-test/receipts.json')))
 const branding=JSON.parse(fs.readFileSync(path.join(root,'deployments/xlayer-test/branding-receipts.json')))
 await Promise.all(Object.entries(plan.runtimeHashes).map(async([address,hash])=>{
  const code=await p.getCode({address});if(!code||sha(Buffer.from(code.slice(2),'hex'))!==hash)throw Error('TEST runtime changed')
 }))
 for(const [name,address]of Object.entries(config.contracts)){
  const recorded=[...branding.transactions,...originals.transactions].find(r=>r.name===name&&same(r.receipt?.contractAddress,address))
  if(!recorded||(recorded.expectedRuntimeSha256??recorded.runtimeCodeSha256)!==plan.runtimeHashes[address.toLowerCase()])throw Error('TEST runtime does not match deployment receipt')
 }
}
const call=(address,signature,args=[])=>p.readContract({address,abi:v.parseAbi([signature]),functionName:signature.match(/function (\w+)/)[1],args})
async function execute(mode,request){
 const s=load()
 if(mode==='status')return {mode:'approved-public-test-acceptance',chainId:196,owner,contracts:config.contracts,transactions:s.rows.map(r=>({hash:r.hash,to:r.to,value:r.value,selector:r.selector})),pending:s.pending,completed:s.completed}
 if(mode==='wallet'&&['eth_accounts','eth_requestAccounts','eth_chainId'].includes(request.method))return request.method==='eth_chainId'?'0xc4':[owner]
 await bindings()
 const nonce=await p.getTransactionCount({address:owner}),pending=await p.getTransactionCount({address:owner,blockTag:'pending'})
 assertAcceptanceProgress(s,plan,nonce,pending)
 if(mode==='activate-continuation'){
  if(s.continuationSha256||s.completed)throw Error('Continuation already activated or completed')
  const recovery=readContinuation()
  if(sha(fs.readFileSync(file))!==recovery.baselineHash)throw Error('Journal changed after recovery rehearsal')
  s.continuationSha256=recovery.hash;s.continuationBaselineSha256=recovery.baselineHash;s.continuationActivatedAt=new Date().toISOString();save(s)
  return {chainId:196,nonce,retainedTransactions:s.rows.length,totalPlannedTransactions:recovery.plan.rows.length,continuationSha256:recovery.hash,totalCapWei:approval.totalCapWei}
 }
 if(mode==='preflight'){
  const gasPrice=await p.getGasPrice(),balance=await p.getBalance({address:owner})
  if(gasPrice>30000000n||balance<320000000000000n)throw Error('Preflight gas or balance changed')
  await assertMiningFeeParameters({call},10000n,8000000n)
  const keys=path.join(os.homedir(),'.local/share/sodadex/wallets/xlayer-test-owner')
  if(!same(execFileSync('cast',['wallet','address','--keystore',keys+'/owner','--password-file',keys+'/password'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim(),owner))throw Error('Final signer mismatch')
  return {chainId:196,nonce,gasPriceWei:String(gasPrice),balanceWei:String(balance),runtimeReceiptsVerified:true,finalSignerVerified:true,planSha256:approval.planSha256,totalCapWei:approval.totalCapWei}
 }
 if(mode==='finalize'){
  if(s.rows.length!==plan.rows.length)throw Error('Incomplete public browser acceptance')
  for(const result of plan.results){
   const manager=config.contracts[result.protocol==='v3'?'v3PositionManager':'v4PositionManager']
   if(!same(await call(manager,'function ownerOf(uint256) view returns(address)',[BigInt(result.tokenId)]),owner))throw Error('Final NFT owner mismatch')
   const liquidity=result.protocol==='v4'?await call(manager,'function getPositionLiquidity(uint256) view returns(uint128)',[BigInt(result.tokenId)]):(await call(manager,'function positions(uint256) view returns(uint96,address,address,address,uint24,int24,int24,uint128,uint256,uint256,uint128,uint128)',[BigInt(result.tokenId)]))[7]
   if(liquidity!==0n)throw Error('Final liquidity is not zero')
  }
  s.completed=true;s.results=plan.results;s.completedAt=new Date().toISOString();save(s);return s
 }
 if(mode!=='wallet'||request.method!=='eth_sendTransaction'||s.completed)throw Error('Acceptance method not allowed')
 const step=plan.rows[s.rows.length],tx=request.params?.[0],now=(await p.getBlock()).timestamp
 assertNextIntent(tx,step,owner,now)
 const value=BigInt(step.value),gas=BigInt(step.plannedGasLimit),price=await p.getGasPrice()
 assertAcceptanceBudget(s,step,price,approval)
 const intent={from:owner,to:tx.to,data:tx.data,value:'0x'+value.toString(16)}
 const gate=await fetch('https://sodadex-preview.jsmsdx2025.workers.dev/api/rpc',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://sodadex-preview.jsmsdx2025.workers.dev'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_estimateGas',params:[intent]}),signal:AbortSignal.timeout(60000)})
 const estimate=await gate.json();if(!gate.ok||estimate.error||BigInt(estimate.result)>gas)throw Error('Published Worker simulation rejected or exceeds rehearsed gas')
 await assertMiningFeeParameters({call},BigInt((tx.data.length-2)/2+200),gas)
 await p.call({account:owner,to:tx.to,data:tx.data,value,gas})
 assertNextIntent(tx,step,owner,(await p.getBlock()).timestamp)
 const keys=path.join(os.homedir(),'.local/share/sodadex/wallets/xlayer-test-owner')
 if(!same(execFileSync('cast',['wallet','address','--keystore',keys+'/owner','--password-file',keys+'/password'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim(),owner))throw Error('Local signer mismatch')
 let raw;try{raw=execFileSync('cast',['mktx','--rpc-url',rpc,'--chain','196','--legacy','--nonce',String(nonce),'--gas-limit',String(gas),'--gas-price',String(price),'--value',String(value),'--keystore',keys+'/owner','--password-file',keys+'/password',tx.to,tx.data],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()}catch{throw Error('Local signing failed')}
 if(await p.getTransactionCount({address:owner})!==nonce||await p.getTransactionCount({address:owner,blockTag:'pending'})!==nonce)throw Error('Signer nonce changed before broadcast')
 const hash=v.keccak256(raw);s.pending={label:step.label,hash,nonce,to:tx.to,selector:tx.data.slice(0,10),value:String(value),gas:String(gas),gasPrice:String(price)};save(s)
 try{await p.request({method:'eth_sendRawTransaction',params:[raw]},{retryCount:0})}catch{throw Error('Broadcast uncertain; reconcile saved hash, never replay')}
 const receipt=await p.waitForTransactionReceipt({hash,timeout:180000,pollingInterval:1500})
 const fabOut=receipt.logs.filter(l=>same(l.address,token)&&l.topics.length===3&&l.topics[0]===v.keccak256(v.toHex('Transfer(address,address,uint256)'))&&same('0x'+l.topics[1].slice(-40),owner)).reduce((sum,l)=>sum+BigInt(l.data),0n)
 s.rows.push({...s.pending,status:receipt.status,gasUsed:String(receipt.gasUsed),feeWei:String(receipt.gasUsed*receipt.effectiveGasPrice),fabSpentRaw:String(fabOut),blockNumber:String(receipt.blockNumber)})
 s.pending=null;s.gasSpentWei=String(BigInt(s.gasSpentWei)+receipt.gasUsed*receipt.effectiveGasPrice);s.nonGasSpentWei=String(BigInt(s.nonGasSpentWei)+value);s.fabSpentRaw=String(BigInt(s.fabSpentRaw)+fabOut)
 if(receipt.status!=='success'||fabOut>BigInt(step.maximumFabSpendRaw))s.stopped=true
 if(step.label.endsWith('create-and-first-add')&&same(tx.to,config.contracts[step.label.startsWith('v3')?'v3PositionManager':'v4PositionManager'])){
  const expected=plan.results.find(r=>step.label.startsWith(r.protocol)),mint=receipt.logs.find(l=>same(l.address,tx.to)&&l.topics.length===4&&BigInt(l.topics[1])===0n)
  if(!mint||BigInt(mint.topics[3])!==BigInt(expected.tokenId)||!same('0x'+mint.topics[2].slice(-40),owner))s.stopped=true
 }
 save(s);if(s.stopped)throw Error('Mined receipt invariant failed; stop without replay')
 return hash
}
const mode=process.argv[2],request=mode==='wallet'?JSON.parse(process.argv[3]):undefined
const readOnly=mode==='status'||mode==='wallet'&&['eth_accounts','eth_requestAccounts','eth_chainId'].includes(request.method)
if(!readOnly)fs.closeSync(fs.openSync(lock,'wx',0o600))
try{console.log(JSON.stringify(await execute(mode,request)))}catch(e){console.error(e.shortMessage??e.message);process.exitCode=1}finally{if(!readOnly)fs.unlinkSync(lock)}
