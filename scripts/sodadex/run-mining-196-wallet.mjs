#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {execFileSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'
import {parseArgs} from 'node:util'
import {build} from 'esbuild'
import {encodeFunctionData,parseAbi,recoverMessageAddress,toHex} from 'viem'
import {PublicMining196} from './mining-196-public.mjs'
import {Mining196WalletExecution,KEEPER_CAP} from './mining-196-wallet-execution.mjs'
import {Mining196BrowserQueue,listenLocal} from './mining-196-browser-wallet.mjs'
const {values:v}=parseArgs({options:Object.fromEntries(['mode','manifest','deployment-journal','rehearsal','approval','ledger','queue','item','digest','token','session-file'].map(k=>[k,{type:'string'}]))})
for(const k of ['mode','manifest','deployment-journal','rehearsal','approval','ledger','queue'])if(!v[k])throw new Error('Required --'+k)
if(!['status','serve','execute','seed-approval','seed','farm-approval','farm-list','retail-approval','retail-list','fund-keeper'].includes(v.mode))throw new Error('Unknown mode')
const root=path.resolve(import.meta.dirname,'../..'),json=f=>JSON.parse(fs.readFileSync(f)),d=json(v.manifest),journal=json(v['deployment-journal']),rehearsal=json(v.rehearsal),approval=json(v.approval)
const keeper=json(path.join(os.homedir(),'.local/share/sodadex/wallets/xlayer-196-mining-keeper/public.json')).address
const moduleFile=path.join(root,'.analysis/mining-196-wallet-policy.mjs')
await build({entryPoints:[path.join(root,'scripts/sodadex/mining-196-wallet-policy.ts')],bundle:true,platform:'node',format:'esm',packages:'external',outfile:moduleFile})
const {wallet196Policy}=await import(pathToFileURL(moduleFile).href)
const transport=new PublicMining196({root,output:v.ledger,rehearsal,approval}),rpc={request:(method,params)=>transport.rpc(method,params)}
const policy=wallet196Policy(d,rpc,journal.owner,rehearsal.stack.signer)
// These proofs precede all CLI submission, signing and queue setup, every invocation.
await policy.verify()
if(v.token)await policy.refreshProject(v.token)
const execution=new Mining196WalletExecution({root,file:v.ledger,deploymentJournal:journal,rehearsal,approval,keeper,
  validateIntent:policy.validate,fabPrincipal:policy.fabPrincipal})
const origin='https://sodadex-preview.jsmsdx2025.workers.dev'
const queue=new Mining196BrowserQueue({file:v.queue,deployment:d,journal,approval,origin,validateCall:policy.validBrowserCall})
if(v.token)await queue.updateProjectsForCli(policy.deployment,async project=>project===policy.deployment.projects[0])
if(v.mode==='serve') {
  if(!v['session-file'])throw new Error('Private --session-file required')
  const server=await listenLocal(queue)
  fs.writeFileSync(v['session-file'],JSON.stringify({origin,port:server.address().port,token:queue.session,owner:journal.owner}),{mode:0o600})
  console.log(JSON.stringify({serving:true,port:server.address().port,privateSessionFile:v['session-file']}))
} else if(v.mode==='status') console.log(JSON.stringify({pending:queue.listPending(),execution:execution.state}))
else if(v.mode==='execute') {
  const item=queue.listPending().find(r=>r.id===v.item&&r.digest===v.digest&&r.status==='queued')
  if(!item)throw new Error('Exact queued --item and --digest required')
  let result
  if(item.method==='personal_sign') {
    queue.claimForCli(item.id,item.digest,{gasLimit:'0',gasPrice:'0'})
    const folder=path.join(os.homedir(),'.local/share/sodadex/wallets/xlayer-test-owner')
    result=execFileSync('cast',['wallet','sign','--keystore',path.join(folder,'owner'),'--password-file',path.join(folder,'password'),'0x'+Buffer.from(item.intent.message).toString('hex')],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
    if((await recoverMessageAddress({message:item.intent.message,signature:result})).toLowerCase()!==journal.owner.toLowerCase())throw new Error('Challenge signature owner mismatch')
  } else {
    const tx={...item.intent,value:toHex(BigInt(item.intent.value)),chainId:'0xc4'}
    const call={from:tx.from,to:tx.to,data:tx.data,value:tx.value}
    if(!await policy.validate(call,'wallet'))throw new Error('CLI wallet policy denied')
    const gas=(BigInt(await rpc.request('eth_estimateGas',[call,'pending']))*120n+99n)/100n
    queue.claimForCli(item.id,item.digest,{gasLimit:String(gas),gasPrice:'21000000'})
    result=await execution.execute(tx)
  }
  queue.resolveFromCli(item.id,item.digest,{result,actualGasWei:execution.state.gasWei,nativeWei:execution.state.nativeWei,keeperFundingWei:execution.state.keeperFundingWei})
  console.log(JSON.stringify({completed:item.id,result:item.method==='personal_sign'?'verified personal signature':result,gasWei:execution.state.gasWei}))
} else {
  const c=d.contracts,owner=journal.owner
  const call=(role,sig,args,value=0n)=>({from:owner,to:c[role].address,data:encodeFunctionData({abi:parseAbi([sig]),functionName:sig.match(/function (\w+)/)[1],args}),value:toHex(value)})
  let tx,purpose='setup'
  if(v.mode==='fund-keeper'){purpose='keeper-funding';tx={from:owner,to:keeper,data:'0x',value:toHex(KEEPER_CAP)}}
  if(v.mode==='seed-approval')tx=call('fab','function approve(address,uint256)',[c.router.address,100000000000n])
  if(v.mode==='seed')tx=call('router','function addLiquidityETH(address,uint256,uint256,uint256,address,uint256)',[c.fab.address,100000000000n,100000000000n,10000000000n,owner,BigInt(Math.floor(Date.now()/1000)+600)],10000000000n)
  if(v.mode.endsWith('-approval')&&v.mode!=='seed-approval')tx=call('circuits','function approve(address,uint256)',[c.circuitMarket.address,v.mode==='farm-approval'?3n:5n])
  if(v.mode.endsWith('-list'))tx=call('circuitMarket','function list(address,uint256,uint96)',[c.circuits.address,v.mode==='farm-list'?3n:5n,1000000n])
  console.log(JSON.stringify({operation:v.mode,hash:await execution.execute(tx,purpose),gasWei:execution.state.gasWei,nativeWei:execution.state.nativeWei,keeperFundingWei:execution.state.keeperFundingWei}))
}
