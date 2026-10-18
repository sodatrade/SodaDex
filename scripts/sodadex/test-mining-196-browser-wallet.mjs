import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Mining196BrowserQueue, validateChallenge, listenLocal, CAP } from './mining-196-browser-wallet.mjs'
const owner='0x'+'11'.repeat(20), target='0x'+'22'.repeat(20), origin='https://sodadex-preview.jsmsdx2025.workers.dev'
function fixture(t, overrides={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mining196-queue-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  const approval={approved:true,chainId:196,profileId:'196-mining-test',totalOwnerOutlayCapWei:String(CAP),planHash:'bound'}
  return {file:path.join(dir,'ledger.json'),origin,approval,
    deployment:{chainId:196,profileId:'196-mining-test',publicDeployment:true,localOnly:false,version:'test196-1',contracts:{fab:{address:target}}},
    journal:{chainId:196,profileId:'196-mining-test',phase:'deployment-inventory-complete',transactions:Array.from({length:55},()=>({status:'0x1'})),owner,approval,planHash:'bound',actualFeesWei:'1000000'},...overrides}
}
const tx=()=>({from:owner,to:target,data:'0x12345678',value:'0x0',chainId:'0xc4'})
test('requires public196, exact approval, complete journal and existing ledger binding',t=>{
  const args=fixture(t); const q=new Mining196BrowserQueue(args)
  assert.equal(fs.statSync(args.file).mode&0o777,0o600)
  assert.throws(()=>new Mining196BrowserQueue({...args,origin:'https://different.example'}),/binding changed/)
  assert.throws(()=>new Mining196BrowserQueue({...args,journal:{...args.journal,pending:{}}}),/55-operation/)
  assert.throws(()=>new Mining196BrowserQueue({...args,deployment:{...args.deployment,chainId:1952}}),/Public 196/)
  assert.equal(q.state.baseGasWei,'1000000')
})
test('rejects unvalidated calldata, external target, transfer and native sends',t=>{
  const args=fixture(t), q=new Mining196BrowserQueue(args)
  assert.throws(()=>q.enqueue('eth_sendTransaction',[tx()]),/Business calldata/)
  assert.throws(()=>q.enqueue('eth_sendTransaction',[{...tx(),to:owner}]),/Target absent/)
  assert.throws(()=>q.enqueue('eth_sendTransaction',[{...tx(),data:'0xa9059cbb'}]),/Transfer/)
  assert.throws(()=>q.enqueue('eth_sendTransaction',[{...tx(),value:'0x1'}]),/Business calldata/)
  assert.throws(()=>q.enqueue('eth_sendTransaction',[{...tx(),nonce:'0x0'}]),/nonce or gas/)
})
test('CLI claim is exact, budgeted, persistent, and cannot be replayed or rejected',t=>{
  const args=fixture(t,{validateCall:()=>true}), q=new Mining196BrowserQueue(args)
  const {requestId}=q.enqueue('eth_sendTransaction',[tx()]), row=q.state.requests[0]
  assert.throws(()=>q.claimForCli(requestId,'wrong',{gasLimit:'21000',gasPrice:'21000000'}),/Exact queued/)
  assert.throws(()=>q.claimForCli(requestId,row.digest,{gasLimit:'21000',gasPrice:'21000001'}),/Gas cap/)
  assert.throws(()=>q.claimForCli(requestId,row.digest,{gasLimit:'9999999999',gasPrice:'21000000'}),/Total owner/)
  q.claimForCli(requestId,row.digest,{gasLimit:'21000',gasPrice:'21000000'})
  const resumed=new Mining196BrowserQueue(args)
  assert.throws(()=>resumed.enqueue('eth_sendTransaction',[tx()]),/Previous request/)
  assert.throws(()=>resumed.reject(requestId),/reconciled/)
  assert.throws(()=>resumed.claimForCli(requestId,row.digest,{gasLimit:'21000',gasPrice:'1'}),/Exact queued/)
})
test('challenge pins origin, chain, deployment, owner, expiry and field layout',t=>{
  const args=fixture(t), context={...args,owner,now:100}
  const m=`SodaDEX 196 test project launch\nOrigin: ${origin}\nChain ID: 196\nDeployment: test196-1\nAddress: ${owner}\nRequest ID: abcdefgh\nExpires at: 200\nName: test\nSymbol: T\nMetadata URI: `
  assert.equal(validateChallenge(m,context),m)
  for(const altered of [m.replace('Chain ID: 196','Chain ID: 1'),m.replace('Expires at: 200','Expires at: 99'),m+'\nextra',m.replace(origin,'https://evil.example')]) assert.throws(()=>validateChallenge(altered,context))
})
test('transport binds loopback, origin, one-use bootstrap and per-process session',async t=>{
  const args=fixture(t), q=new Mining196BrowserQueue(args), server=await listenLocal(q)
  t.after(()=>server.close()); assert.equal(server.address().address,'127.0.0.1')
  const url=`http://127.0.0.1:${server.address().port}`
  const request=(route,token,site=origin)=>fetch(url+route,{method:'POST',headers:{origin:site,'x-wallet-session':token}})
  assert.equal((await request('/session',q.session,'https://evil.example')).status,400)
  const response=await request('/session',q.session);assert.equal(response.status,200)
  const {session}=await response.json();assert.equal((await request('/session',q.session)).status,400)
  assert.equal((await request('/queue','wrong')).status,400)
  assert.equal((await request('/execute',session)).status,400)
})
test('CLI receipt result preserves cumulative gas/funding and cannot settle twice',t=>{
  const args=fixture(t,{validateCall:()=>true}),q=new Mining196BrowserQueue(args)
  const {requestId}=q.enqueue('eth_sendTransaction',[tx()]), row=q.listPending()[0]
  q.claimForCli(requestId,row.digest,{gasLimit:'21000',gasPrice:'21000000'})
  const result={result:'0x'+'ab'.repeat(32),actualGasWei:'2000000',nativeWei:'0',keeperFundingWei:'80000000000000'}
  assert.throws(()=>q.resolveFromCli(requestId,row.digest,{...result,actualGasWei:String(CAP)}),/outlay cap/)
  q.resolveFromCli(requestId,row.digest,result)
  assert.equal(new Mining196BrowserQueue(args).state.keeperFundingWei,'80000000000000')
  assert.throws(()=>q.resolveFromCli(requestId,row.digest,result),/Exact claimed/)
  const next=q.enqueue('eth_sendTransaction',[tx()]), nextrow=q.listPending()[0]
  q.claimForCli(next.requestId,nextrow.digest,{gasLimit:'21000',gasPrice:'21000000'})
  assert.throws(()=>q.resolveFromCli(next.requestId,nextrow.digest,{...result,keeperFundingWei:'0'}),/cannot decrease/)
})
test('dynamic projects require independent CLI verification with immutable base roles',async t=>{
  const args=fixture(t),q=new Mining196BrowserQueue(args)
  const project={token:{address:owner},vault:{address:owner},holder:{address:owner}}
  const next={...args.deployment,projects:[project]}
  await assert.rejects(q.updateProjectsForCli(next,async()=>false),/chain verification/)
  await assert.rejects(q.updateProjectsForCli({...next,contracts:{}},async()=>true),/Base deployment/)
  await q.updateProjectsForCli(next,async()=>true)
  assert.equal(q.targets.has(owner),true)
  assert.equal(new Mining196BrowserQueue(args).targets.has(owner),false)
})
test('approved native route still cannot exceed cumulative principal cap',t=>{
  const q=new Mining196BrowserQueue(fixture(t,{validateCall:()=>true}))
  assert.throws(()=>q.enqueue('eth_sendTransaction',[{...tx(),value:'0x'+(11000000001n).toString(16)}]),/Native principal cap/)
  q.enqueue('eth_sendTransaction',[{...tx(),value:'0x1'}])
  assert.equal(q.listPending()[0].intent.value,'1')
})
