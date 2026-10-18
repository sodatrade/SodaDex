import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { keccak256, toHex } from 'viem'
import { loadSmokeModules, validateSmokeApproval, SmokeSender } from './mining-online-smoke.mjs'
import { ONLINE_OWNER } from './mining-online-assets.mjs'
const root=process.cwd(), keeper='0x553D8C2e637fe67C5c7AdE3810E8Bc02799D41D4'
function fixture() {
 const p=JSON.parse(fs.readFileSync(path.join(root,'deployments/xlayer-1952/2026-10-18-online-service-plan.json')))
 p.approved=true;p.approvalReference='fixture approval only'
 const a={publicTestnet:true,chainId:1952,owner:ONLINE_OWNER,planSha256:p.assets.planSha256,startNonce:'118',actualFeesWei:'90000000000000',transactions:Array.from({length:14},()=>({status:'0x1'}))}
 return {p,a}
}
test('only exact newly approved phase and completed assets permit smoke admission',()=>{
 const {p,a}=fixture();assert.doesNotThrow(()=>validateSmokeApproval(p,a))
 for(const c of [{approved:false},{chainId:196},{owner:keeper},{keeper:ONLINE_OWNER},{publicOrigin:'https://evil.test'}])assert.throws(()=>validateSmokeApproval({...p,...c},a))
 for(const c of [{pending:{hash:'0x1'}},{actualFeesWei:'500000000000001'},{transactions:[]},{planSha256:'other'}])assert.throws(()=>validateSmokeApproval(p,{...a,...c}))
 const wrong=structuredClone(p);wrong.proposedBudget.fabPrincipalCapRaw='2000000000000';assert.throws(()=>validateSmokeApproval(wrong,a))
})
test('dry-run CLI needs no approval, wallet, network, or cast',()=>{
 const out=execFileSync(process.execPath,['scripts/sodadex/mining-online-smoke.mjs'],{cwd:root,encoding:'utf8',env:{PATH:'/usr/bin:/bin'}})
 assert.deepEqual(JSON.parse(out),{dryRun:true,chainId:1952,project:'TEST-ONLINE',ownerGasCapWei:'500000000000000',newApprovalFileRequired:true,signing:false,publicWrites:false})
})
test('bundled real frontend codecs reject changed chain/target and retain actual quote planner',async()=>{
 const folder=fs.mkdtempSync(path.join(root,'.analysis-smoke-test-'))
 try {
  const m=await loadSmokeModules(root,folder),d=m.parseMiningDeployment(JSON.parse(fs.readFileSync(path.join(root,'deployments/xlayer-1952/products.json'))))
  const p=d.projects[0],plan=m.simpleMiningPlan(ONLINE_OWNER,p.holder.address,'holder','claim','claim'),tx=plan.calls[0].tx
  assert.equal(m.validMiningProductCall(tx,d,true),true)
  assert.equal(m.validMiningProductCall({...tx,to:keeper},d,true),false)
  assert.equal(m.validMiningProductCall(tx,{...d,chainId:196},true),false)
  assert.equal(typeof m.buildMiningPlan,'function');assert.equal(typeof m.verifyMiningBase,'function');assert.equal(typeof m.resolveMiningProject,'function')
 }finally{fs.rmSync(folder,{recursive:true,force:true})}
})
function sender() {
 const {p,a}=fixture(),folder=fs.mkdtempSync(path.join(os.tmpdir(),'sodadex-smoke-')),file=path.join(folder,'journal.json')
 let signs=0,sends=0,price=20000001n,changed=false
 const hash=keccak256('0x1234'),blockHash=keccak256('0x5678')
 const tx={from:ONLINE_OWNER,to:keeper,data:'0x12345678',value:'0x0'}
 const receipt={transactionHash:hash,from:ONLINE_OWNER,to:keeper,gasUsed:'0x5208',effectiveGasPrice:toHex(price),blockNumber:'0x10',blockHash,status:'0x1'}
 const methods=[]
 const rpc={request:async(method,params=[])=>{
  methods.push(method)
  if(method==='eth_getBlockByNumber')return {number:params[0],hash:changed?'0xchanged':blockHash}
  if(method==='eth_getTransactionCount')return '0x84'
  if(method==='eth_call')return '0x'
  if(method==='eth_estimateGas')return '0x5208'
  if(method==='eth_gasPrice')return toHex(price)
  if(method==='eth_blockNumber')return '0x11'
  if(method==='eth_getTransactionReceipt')return receipt
  if(method==='eth_sendRawTransaction'){
   sends++;const saved=JSON.parse(fs.readFileSync(file));assert.equal(saved.pending.hash,hash);assert.equal(saved.pending.raw,'0x1234');assert.equal(saved.pending.submission,'unknown');assert.equal(fs.statSync(file).mode&0o777,0o600)
   throw new Error('response lost')
  }
  throw new Error('unexpected method')
 }}
 const s=new SmokeSender({rpc,modules:{validMiningProductCall:()=>true},deployment:{},approval:p,assets:a,output:file,sign:async()=>{signs++;return '0x1234'},validateSigned:async raw=>keccak256(raw)})
 s.verify=async()=>{};s.fees=async()=>{};s.state.startNonce='132';s.assetAnchor={number:'0x10',hash:blockHash}
 return {s,tx,file,folder,receipt,methods,stats:()=>({signs,sends}),setPrice:v=>{price=v},reorg:()=>{changed=true}}
}
test('lost broadcast response keeps one private raw/hash and prevents a second signature or send',async()=>{
 const f=sender()
 try{
  await assert.rejects(()=>f.s.send('fixture',f.tx),/response lost/)
  await assert.rejects(()=>f.s.send('fixture',f.tx),/original hash/)
  assert.deepEqual(f.stats(),{signs:1,sends:1});assert.equal(f.s.state.pending.submission,'unknown')
  const saved=JSON.parse(fs.readFileSync(f.file));assert.equal(saved.pending.raw,'0x1234')
  f.setPrice(40000000n)
  await f.s.finish(f.receipt)
  assert.equal(f.s.state.pending,null);assert.equal(f.s.state.actualOwnerFeesWei,String(90000000000000n+21000n*20000001n))
  assert.deepEqual(f.stats(),{signs:1,sends:1})
 }finally{fs.rmSync(f.folder,{recursive:true,force:true})}
})
test('reorg and unknown fee keep pending reservation and actual costs unchanged',async()=>{
 for(const variant of ['reorg','fee']){
  const f=sender()
  try{
   await assert.rejects(()=>f.s.send('fixture',f.tx),/response lost/)
   if(variant==='reorg')f.reorg();else f.receipt.operatorFee='0x1'
   await assert.rejects(()=>f.s.finish(f.receipt))
   assert.ok(f.s.state.pending);assert.equal(f.s.state.actualOwnerFeesWei,'90000000000000');assert.equal(f.s.state.transactions.length,0)
  }finally{fs.rmSync(f.folder,{recursive:true,force:true})}
 }
})
test('owner gas price, cumulative gas and FAB caps stop before signing/broadcast',async()=>{
 for(const kind of ['price','gas','fab']){
  const f=sender()
  try{
   if(kind==='price')f.setPrice(30000001n)
   if(kind==='gas')f.s.state.actualOwnerFeesWei='500000000000000'
   if(kind==='fab')await assert.rejects(()=>f.s.executePlan({calls:[]},600000000001n),/principal cap/)
   else await assert.rejects(()=>f.s.send('fixture',f.tx),/gas cap or price/)
   assert.deepEqual(f.stats(),{signs:0,sends:0})
  }finally{fs.rmSync(f.folder,{recursive:true,force:true})}
 }
})
test('challenge uses the real human-readable origin/deployment binding and rejects an altered response',async()=>{
 const folder=fs.mkdtempSync(path.join(root,'.analysis-smoke-api-')),previousFetch=globalThis.fetch,previousLocation=globalThis.location
 try{
  const m=await loadSmokeModules(root,folder),d=m.parseMiningDeployment(JSON.parse(fs.readFileSync(path.join(root,'deployments/xlayer-1952/products.json'))))
  const origin='https://sodadex-mining-test-1952.jsmsdx2025.workers.dev';globalThis.location={origin}
  let altered=false
  globalThis.fetch=async(_url,init)=>{
   const b=JSON.parse(init.body),expiresAt=Math.floor(Date.now()/1000)+60
   assert.equal(b.form.name,'TEST SodaDEX ONLINE');assert.equal(b.address,ONLINE_OWNER)
   const message=[`SodaDEX 1952 test project launch`,`Origin: ${altered?'https://evil.test':origin}`,'Chain ID: 1952',`Deployment: ${d.version}`,`Address: ${ONLINE_OWNER.toLowerCase()}`,`Request ID: ${b.requestId}`,`Expires at: ${expiresAt}`,`Name: ${b.form.name}`,`Symbol: ${b.form.symbol}`,`Metadata URI: ${b.form.metadataURI}`].join('\n')
   return Response.json({schemaVersion:1,chainId:1952,deploymentVersion:d.version,...b,message,expiresAt})
  }
  const form={name:'TEST SodaDEX ONLINE',symbol:'TEST-ONLINE',metadataURI:''}
  const c=await m.createLaunchChallenge(d,ONLINE_OWNER,'fixture-request-id',form);assert.ok(c.message.includes('Chain ID: 1952'))
  altered=true;await assert.rejects(()=>m.createLaunchChallenge(d,ONLINE_OWNER,'other-id',form),/onlineInvalidResponse/)
 }finally{globalThis.fetch=previousFetch;globalThis.location=previousLocation;fs.rmSync(folder,{recursive:true,force:true})}
})
test('registration must match the exact new Manager receipt and TEST-ONLINE symbol',async()=>{
 const {assertSmokeRegistration}=await import('./mining-online-smoke.mjs')
 const {encodeEventTopics,encodeAbiParameters,parseAbiParameters,parseAbi}=await import('viem')
 const d=JSON.parse(fs.readFileSync(path.join(root,'deployments/xlayer-1952/products.json'))),project={...d.projects[0],symbol:'TEST-ONLINE'}
 const abi=parseAbi(['event TokenCreated(address indexed token,address indexed creator,address indexed quote,uint256 graduation,string metadataURI,address vault,address tracker,uint16 templateId)'])
 const log={address:d.contracts.manager.address,topics:encodeEventTopics({abi,eventName:'TokenCreated',args:{token:project.token.address,creator:ONLINE_OWNER,quote:d.contracts.fab.address}}),data:encodeAbiParameters(parseAbiParameters('uint256,string,address,address,uint16'),[500000000000n,'',project.vault.address,project.holder.address,d.templateId])}
 assert.doesNotThrow(()=>assertSmokeRegistration({logs:[log]},d,project))
 assert.throws(()=>assertSmokeRegistration({logs:[log]},d,{...project,symbol:'TEST-OTHER'}))
 assert.throws(()=>assertSmokeRegistration({logs:[log]},d,{...project,token:{address:keeper}}))
 assert.throws(()=>assertSmokeRegistration({logs:[]},d,project))
})
