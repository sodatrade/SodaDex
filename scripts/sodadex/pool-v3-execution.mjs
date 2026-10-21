// Exact independent TEST repair stage. No private key or raw signed transaction is persisted.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {createRequire} from 'node:module'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {assertMiningFeeParameters} from './mining-fee-model.mjs'
const root=path.resolve(import.meta.dirname,'../..'),dir=path.join(root,'deployments/xlayer-196-fragments-test/pool-v3'),require=createRequire(root+'/standalone/web/package.json'),v=require('viem')
const json=x=>JSON.stringify(x,(_,y)=>typeof y==='bigint'?String(y):y,2)+'\n',hash=x=>createHash('sha256').update(x).digest('hex')
const rpc='https://rpc.ignix.bot/rpc/196',p=v.createPublicClient({transport:v.http(rpc,{timeout:60000,retryCount:1})})
const plan=JSON.parse(fs.readFileSync(dir+'/rehearsal.json')),approval=JSON.parse(fs.readFileSync(dir+'/approval.json')),old=JSON.parse(fs.readFileSync(path.dirname(dir)+'/public-journal.json'))
const file=dir+'/public-journal.json',lock=file+'.lock',owner=plan.owner
const artifacts=Object.fromEntries(['SodaPool','SodaLocker','SodaVault','IgnixLpRewards'].map(n=>[n,JSON.parse(fs.readFileSync(path.join(os.homedir(),`XTruthWorkspace/contract/out/${n}.sol/${n}.json`)))]))
const read=(address,n,functionName,args=[])=>p.readContract({address,abi:artifacts[n].abi,functionName,args})
const same=(a,b)=>a.toLowerCase()===b.toLowerCase()
async function binding(){
 if(!approval.approved||approval.chainId!==196||approval.totalCapWei!=='370000000000000'||approval.gasCapWei!=='366900000000000'||approval.nonGasCapWei!=='330100000000'||approval.maxGasPriceWei!=='30000000'||approval.production!==false)throw Error('Exact approval required')
 if(await p.getChainId()!==196)throw Error('Wrong chain')
 for(const[n,a]of Object.entries(artifacts)){
  if(hash(JSON.stringify(a))!==plan.sourceHashes[n])throw Error('Compiler artifacts changed')
  const m=typeof a.metadata==='string'?JSON.parse(a.metadata):a.metadata
  for(const[f,i]of Object.entries(m.sources))if(v.keccak256(v.toHex(fs.readFileSync(path.resolve(os.homedir(),'XTruthWorkspace/contract',f))))!==i.keccak256)throw Error('Compiler source changed')
 }
 for(const n of ['SodaVault','SodaPolicy'])if(v.keccak256(await p.getCode({address:old.contracts[n].address}))!==old.contracts[n].runtimeHash)throw Error('TEST dependency changed')
}
function load(){return fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{chainId:196,owner,treasury:old.treasury,productionTouched:false,localOnly:false,publicDeployed:false,completed:false,deploymentVerified:false,startNonce:plan.startNonce,contracts:{SodaVault:old.contracts.SodaVault,SodaPolicy:old.contracts.SodaPolicy},rows:[],gasSpentWei:'0',nonGasSpentWei:'0',pending:null}}
const save=s=>{fs.writeFileSync(file+'.tmp',json(s));fs.renameSync(file+'.tmp',file)}
async function runtime(address){for(let i=0;i<8;i++){const code=await p.getCode({address});if(code&&code!=='0x')return v.keccak256(code);await new Promise(r=>setTimeout(r,1000))}throw Error('Runtime unavailable; stop')}
async function send(s,tx){
 const i=s.rows.length,step=plan.rows[i];if(!step||s.pending||s.rows.some(row=>row.status!=='success'))throw Error('Stage complete or pending; no replay')
 const nonce=await p.getTransactionCount({address:owner});if(nonce!==plan.startNonce+i||nonce!==await p.getTransactionCount({address:owner,blockTag:'pending'}))throw Error('Nonce changed; reconcile first')
 const value=BigInt(tx.value??0),gas=BigInt(step.plannedGasLimit),price=await p.getGasPrice()
 if(price<=0n||price>30000000n||BigInt(s.gasSpentWei)+gas*price>366900000000000n||BigInt(s.nonGasSpentWei)+value>330100000000n||BigInt(s.gasSpentWei)+gas*price+BigInt(s.nonGasSpentWei)+value>370000000000000n)throw Error('Approved budget stops transaction')
 await assertMiningFeeParameters({call:(address,signature,args=[])=>p.readContract({address,abi:v.parseAbi([signature]),functionName:signature.match(/function (\w+)/)[1],args})},BigInt((tx.data.length-2)/2+200),gas)
 await p.call({account:owner,...tx,value,gas})
 const keys=path.join(os.homedir(),'.local/share/sodadex/wallets/xlayer-test-owner')
 if(execFileSync('cast',['wallet','address','--keystore',keys+'/owner','--password-file',keys+'/password'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim().toLowerCase()!==owner.toLowerCase())throw Error('Signer mismatch')
 let raw;try{raw=execFileSync('cast',['mktx','--rpc-url',rpc,'--chain','196','--legacy','--nonce',String(nonce),'--gas-limit',String(gas),'--gas-price',String(price),'--value',String(value),'--keystore',keys+'/owner','--password-file',keys+'/password',...(tx.to?[tx.to,tx.data]:['--create',tx.data])],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()}catch{throw Error('Local signing failed')}
 const txHash=v.keccak256(raw);s.pending={label:step.label,hash:txHash,nonce,to:tx.to??null,value:String(value),gas:String(gas),gasPrice:String(price)};save(s)
 try{await p.request({method:'eth_sendRawTransaction',params:[raw]},{retryCount:0})}catch{throw Error('Broadcast uncertain; saved hash requires reconciliation, never replay')}
 const receipt=await p.waitForTransactionReceipt({hash:txHash,timeout:180000,pollingInterval:1500});const fee=receipt.gasUsed*receipt.effectiveGasPrice
 s.rows.push({...s.pending,status:receipt.status,gasUsed:String(receipt.gasUsed),feeWei:String(fee),blockNumber:String(receipt.blockNumber),contractAddress:receipt.contractAddress});s.pending=null;s.gasSpentWei=String(BigInt(s.gasSpentWei)+fee);s.nonGasSpentWei=String(BigInt(s.nonGasSpentWei)+value);save(s)
 if(receipt.status!=='success')throw Error('Transaction reverted; stop without replay')
 await new Promise(r=>setTimeout(r,2500));return receipt
}
async function execute(mode,request){
 await binding();const s=load();if(s.pending||s.rows.some(row=>row.status!=='success'))throw Error('Stage stopped: reconcile pending or failed receipt before any continuation')
 if(mode==='preflight'){
  const nonce=await p.getTransactionCount({address:owner}),pending=await p.getTransactionCount({address:owner,blockTag:'pending'}),gasPrice=await p.getGasPrice(),balance=await p.getBalance({address:owner})
  if(nonce!==plan.startNonce+s.rows.length||nonce!==pending||gasPrice>30000000n||balance<370000000000000n)throw Error('Preflight nonce/gas/balance mismatch')
  return {chainId:196,nonce,gasPrice:String(gasPrice),balance:String(balance),sourceVerified:true,dependencyVerified:true,approvedCapWei:approval.totalCapWei}
 }
 if(mode==='deploy'){
  if(s.rows.length!==0)throw Error('Deployment already started; reconcile instead')
  for(const[n,args,address]of [['SodaPool',[plan.va],plan.pool],['SodaLocker',[plan.pool,owner],plan.locker]]){
   const a=artifacts[n],receipt=await send(s,{data:v.encodeDeployData({abi:a.abi,bytecode:a.bytecode.object,args})})
   if(!receipt.contractAddress||!same(receipt.contractAddress,address))throw Error('Predicted address mismatch')
   const runtimeHash=await runtime(address);if(runtimeHash!==plan.runtimeHashes[n==='SodaPool'?'pool':'locker'])throw Error('Rehearsed runtime mismatch')
   s.contracts[n]={address,runtimeHash};save(s)
  }
  const rewards=await read(plan.pool,'SodaPool','REWARDS');if(!same(rewards,plan.rewards)||await runtime(rewards)!==plan.runtimeHashes.rewards)throw Error('Rewards binding mismatch')
  s.contracts.IgnixLpRewards={address:rewards,runtimeHash:plan.runtimeHashes.rewards}
  // One exact bounded allowance covers browser add/add/sell; no unlimited approval.
  const step=plan.rows[2];await send(s,{to:step.to,data:step.data,value:BigInt(step.value)})
  s.deploymentVerified=true;s.publicDeployed=true;save(s);return {contracts:s.contracts,gasSpentWei:s.gasSpentWei}
 }
 if(!s.deploymentVerified)throw Error('Deploy and verify first')
 if(mode==='wallet'){
  if(['eth_accounts','eth_requestAccounts'].includes(request.method))return [owner]
  if(request.method==='eth_chainId')return '0xc4'
  if(request.method!=='eth_sendTransaction')throw Error('Unsupported wallet method')
  const i=s.rows.length;if(i<3||i>7)throw Error('Only five browser acceptance operations allowed')
  const tx=request.params?.[0],step=plan.rows[i]
  if(!tx||!same(tx.from,owner)||!same(tx.to,plan.pool)||Number(tx.chainId)!==196||BigInt(tx.value??0)!==BigInt(step.value))throw Error('Wrong wallet intent')
  if(await runtime(plan.pool)!==plan.runtimeHashes.pool)throw Error('Pool runtime mismatch')
  const decoded=v.decodeFunctionData({abi:artifacts.SodaPool.abi,data:tx.data}),expected=v.decodeFunctionData({abi:artifacts.SodaPool.abi,data:step.data})
  if(decoded.functionName!==expected.functionName||decoded.args[0]!==expected.args[0])throw Error('Unexpected business operation')
  const args=decoded.args,deadline=args.at(-1),now=(await p.getBlock()).timestamp;if(deadline<=now||deadline>now+1800n)throw Error('Deadline invalid')
  if(decoded.functionName==='swap'){
   if(args[1]!==expected.args[1])throw Error('Swap amount changed')
   const q=await read(plan.pool,'SodaPool','quote',[args[0],args[1]]);if(args[2]<=0n||args[2]<q[0]*995n/1000n)throw Error('Output floor invalid')
  }else if(decoded.functionName==='addLiquidity'){
   if(args[1]<=0n||args[2]<=0n||args[1]<expected.args[1]||args[2]<expected.args[2])throw Error('Add minimum below rehearsal')
  }else if(decoded.functionName==='removeLiquidity'){
   const supply=await read(plan.pool,'SodaPool','totalSupply'),rs=await read(plan.pool,'SodaPool','reserveShares'),ro=await read(plan.pool,'SodaPool','reserveOkb');if(args[1]<rs*args[0]/supply*995n/1000n||args[2]<ro*args[0]/supply*995n/1000n)throw Error('Remove minimum below policy')
  }
  const receipt=await send(s,{to:tx.to,data:tx.data,value:BigInt(tx.value??0)});return receipt.transactionHash
 }
 if(mode==='lock'){
  if(s.rows.length!==8)throw Error('Complete browser acceptance first')
  const amount=await read(plan.pool,'SodaPool','balanceOf',[owner]);if(amount<=0n)throw Error('No remaining LP')
  await send(s,{to:plan.pool,data:v.encodeFunctionData({abi:artifacts.SodaPool.abi,functionName:'approve',args:[plan.locker,amount]})})
  await send(s,{to:plan.locker,data:v.encodeFunctionData({abi:artifacts.SodaLocker.abi,functionName:'lock',args:[amount]})})
  if(await read(plan.pool,'SodaPool','balanceOf',[owner])!==0n||await read(plan.pool,'SodaPool','balanceOf',[plan.locker])!==amount)throw Error('LP custody failed')
  s.completed=true;s.final={lockedLp:String(amount),reserveShares:String(await read(plan.pool,'SodaPool','reserveShares')),reserveOkb:String(await read(plan.pool,'SodaPool','reserveOkb')),unlockAt:String(await read(plan.locker,'SodaLocker','unlockAt'))};save(s);return s.final
 }
 throw Error('Explicit execution mode required')
}
const mode=process.argv[2];const request=mode==='wallet'?JSON.parse(process.argv[3]):undefined
if(mode==='wallet'&&['eth_accounts','eth_requestAccounts','eth_chainId'].includes(request.method)){if(!approval.approved)throw Error('Approval required');console.log(JSON.stringify(request.method==='eth_chainId'?'0xc4':[owner]));process.exit(0)}
fs.closeSync(fs.openSync(lock,'wx',0o600));try{const result=await execute(mode,request);console.log(JSON.stringify(result))}catch(e){console.error(e.shortMessage??e.message);process.exitCode=1}finally{fs.unlinkSync(lock)}
