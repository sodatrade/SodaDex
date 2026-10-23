// Read-only public-chain verification of the completed TEST phase; no signer is imported.
import fs from 'node:fs'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {canonicalIntentData} from './ordinary-intent.mjs'
import {assertContinuation,assertJournalTotals,assertRetainedPrefix} from './ordinary-continuation.mjs'
const require=createRequire(new URL('../web/package.json',import.meta.url)),v=require('viem')
const dir=new URL('../../deployments/xlayer-test/ordinary-pools/',import.meta.url),read=name=>fs.readFileSync(new URL(name,dir)),parse=name=>JSON.parse(read(name)),sha=x=>createHash('sha256').update(x).digest('hex')
const config=JSON.parse(fs.readFileSync(new URL('../../deployments/xlayer-test/active.json',import.meta.url))),base=parse('final-rehearsal.json'),approval=parse('public-approval.json'),child=parse('remaining-rehearsal.json'),baseline=parse('public-journal-before-continuation.json'),continuation=parse('continuation.json'),journal=parse('public-journal.json')
const plan=assertContinuation(base,child,baseline,continuation,{base:sha(read('final-rehearsal.json')),approval:sha(read('public-approval.json')),baseline:sha(read('public-journal-before-continuation.json')),child:sha(read('remaining-rehearsal.json'))},config.permit2,approval)
assertRetainedPrefix(journal,baseline,sha(read('continuation.json')));assertJournalTotals(journal)
if(!journal.completed||journal.pending||journal.stopped||journal.rows.length!==plan.rows.length)throw Error('Completed phase required')
const p=v.createPublicClient({transport:v.http(config.rpcUrl,{timeout:30000,retryCount:1})}),same=(a,b)=>a?.toLowerCase()===b?.toLowerCase()
if(await p.getChainId()!==196)throw Error('Wrong chain')
let gas=0n,native=0n,fab=0n
const rows=[]
for(let i=0;i<journal.rows.length;i++){
 const row=journal.rows[i],expected=plan.rows[i],tx=await p.getTransaction({hash:row.hash}),receipt=await p.getTransactionReceipt({hash:row.hash}),block=await p.getBlock({blockNumber:receipt.blockNumber})
 const fee=receipt.gasUsed*receipt.effectiveGasPrice
 const out=receipt.logs.filter(l=>same(l.address,'0x842b7bf61f2cb4be8aacac6adece3244c2a6f6ab')&&l.topics.length===3&&l.topics[0]===v.keccak256(v.toHex('Transfer(address,address,uint256)'))&&same('0x'+l.topics[1].slice(-40),plan.owner)).reduce((sum,l)=>sum+BigInt(l.data),0n)
 if(receipt.status!=='success'||block.hash!==receipt.blockHash||!same(tx.from,plan.owner)||tx.chainId!==196||tx.nonce!==168+i||tx.nonce!==row.nonce||!same(tx.to,expected.to)||tx.value!==BigInt(expected.value)||tx.gas!==BigInt(expected.plannedGasLimit)||tx.gasPrice>BigInt(approval.maxGasPriceWei)||canonicalIntentData(tx.input,0n,false)!==canonicalIntentData(expected.data,0n,false)||fee!==BigInt(row.feeWei)||out!==BigInt(row.fabSpentRaw)||out>BigInt(expected.maximumFabSpendRaw))throw Error('Receipt/intent mismatch at '+i)
 const raw=await p.request({method:'eth_getTransactionReceipt',params:[row.hash]})
 if(BigInt(raw.l1Fee??0)!==0n||BigInt(raw.operatorFee??0)!==0n)throw Error('Unexpected extra fee')
 gas+=fee;native+=tx.value;fab+=out
 rows.push({hash:row.hash,nonce:tx.nonce,action:row.label,status:receipt.status,blockNumber:String(receipt.blockNumber),feeWei:String(fee),nativeInputWei:String(tx.value),testFabInputRaw:String(out)})
}
if(gas!==BigInt(journal.gasSpentWei)||native!==BigInt(journal.nonGasSpentWei)||fab!==BigInt(journal.fabSpentRaw)||gas>BigInt(approval.gasCapWei)||native>BigInt(approval.nonGasCapWei)||gas+native>BigInt(approval.totalCapWei)||fab>BigInt(approval.maxTestTokenApprovalsRaw))throw Error('Final cumulative budget mismatch')
for(const[address,hash]of Object.entries(plan.runtimeHashes)){const code=await p.getCode({address});if(!code||sha(Buffer.from(code.slice(2),'hex'))!==hash)throw Error('TEST runtime mismatch')}
const call=(address,signature,args)=>p.readContract({address,abi:v.parseAbi([signature]),functionName:signature.match(/function (\w+)/)[1],args})
const results=[]
for(const result of plan.results){
 const manager=config.contracts[result.protocol==='v3'?'v3PositionManager':'v4PositionManager'],id=BigInt(result.tokenId),owner=await call(manager,'function ownerOf(uint256) view returns(address)',[id])
 let liquidity,owed0=0n,owed1=0n
 if(result.protocol==='v4')liquidity=await call(manager,'function getPositionLiquidity(uint256) view returns(uint128)',[id])
 else{const pos=await call(manager,'function positions(uint256) view returns(uint96,address,address,address,uint24,int24,int24,uint128,uint256,uint256,uint128,uint128)',[id]);liquidity=pos[7];owed0=pos[10];owed1=pos[11]}
 if(!same(owner,plan.owner)||liquidity!==0n||owed0!==0n||owed1!==0n)throw Error('Final position invariant failed')
 results.push({...result,owner,manager,liquidity:String(liquidity),...(result.protocol==='v3'?{owed0:String(owed0),owed1:String(owed1)}:{})})
}
const latest=await p.getTransactionCount({address:plan.owner}),pending=await p.getTransactionCount({address:plan.owner,blockTag:'pending'})
if(latest!==193||pending!==193)throw Error('Unexpected final signer nonce')
console.log(JSON.stringify({at:new Date().toISOString(),chainId:196,mode:'read-only-public-verification',sourceCommit:'741eace17566ba015e940b25b7e03cef105e134c',productionTouched:false,successfulTransactions:rows.length,startNonce:168,nextNonce:latest,pendingNonce:pending,gasSpentWei:String(gas),grossNativeInputWei:String(native),grossNativeTotalWei:String(gas+native),testFabInputRaw:String(fab),totalCapWei:approval.totalCapWei,budgetRemainingWei:String(BigInt(approval.totalCapWei)-gas-native),journalSha256:sha(read('public-journal.json')),runtimeHashesVerified:Object.keys(plan.runtimeHashes).length,results,rows},null,2))
