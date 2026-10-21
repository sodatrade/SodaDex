// Real workerd + durable SQLite. All RPC responses are fixtures; no chain writes.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeAbiParameters, encodeEventTopics, parseAbi, parseAbiParameters } from 'viem'
const require=createRequire(import.meta.url),{build}=require('esbuild'),{Miniflare,Log,LogLevel,convertV4MiniflareOptions}=require('miniflare')
const root=fileURLToPath(new URL('../../../',import.meta.url)),folder=await mkdtemp(resolve(tmpdir(),'fragment-index-'))
const pool=`0x${'11'.repeat(20)}`,owner=`0x${'22'.repeat(20)}`,hex=n=>`0x${n.toString(16)}`,hash=n=>`0x${n.toString(16).padStart(64,'0')}`
const abi=parseAbi(['event Swapped(address indexed account,bool shareIn,uint256 input,uint256 output,uint256 platformFee,uint256 lpFee)'])
let mf,rpcCount=0,generation=0
const rows=()=>Array.from({length:23},(_,i)=>({address:pool,blockNumber:hex(110),blockHash:hash(110+generation*100000),transactionHash:hash(1000+i+generation*100000),logIndex:hex(i),removed:false,topics:encodeEventTopics({abi,eventName:'Swapped',args:{account:owner}}),data:encodeAbiParameters(parseAbiParameters('bool,uint256,uint256,uint256,uint256'),[false,100n,200n,3n,7n])}))
const entry=resolve(folder,'entry.ts'),bundle=resolve(folder,'worker.mjs')
await writeFile(entry,`import {fragmentsIndexApi} from ${JSON.stringify(resolve(root,'standalone/worker/src/chain-index/fragments.ts'))};export {SodaChainIndex} from ${JSON.stringify(resolve(root,'standalone/worker/src/chain-index/durable.ts'))};export default {fetch:fragmentsIndexApi}`)
await build({entryPoints:[entry],outfile:bundle,bundle:true,format:'esm',platform:'browser',target:'es2022',alias:{viem:resolve(root,'standalone/worker/node_modules/viem/_esm/index.js')}})
const options=()=>({name:'fragment-index-fixture',script:readFileSync(bundle,'utf8'),modules:true,compatibilityDate:'2026-10-18',port:0,cf:false,log:new Log(LogLevel.NONE),
 bindings:{SODADEX_FRAGMENTS_DEPLOYMENT:JSON.stringify({chainId:196,pool,fromBlock:'100'})},durableObjects:{CHAIN_INDEX:{className:'SodaChainIndex',useSQLite:true}},resourcePersistencePath:resolve(folder,'persist'),unsafeInspectDurableObjects:true,telemetry:{enabled:false},
 outboundService:async request=>{
  assert.equal(request.url,'https://rpc.ignix.bot/rpc/196');const body=await request.json();rpcCount++
  assert.ok(['eth_chainId','eth_getLogs','eth_getBlockByNumber'].includes(body.method))
  let result;if(body.method==='eth_chainId')result='0xc4';else if(body.method==='eth_getLogs'){const f=body.params[0];result=rows().filter(r=>BigInt(r.blockNumber)>=BigInt(f.fromBlock)&&BigInt(r.blockNumber)<=BigInt(f.toBlock));assert.ok([f.address].flat().every(a=>a===pool))}
  else{const n=body.params[0]==='latest'?4000:Number(BigInt(body.params[0]));result={number:hex(n),hash:hash(n+generation*100000),timestamp:hex(1700000000+n),transactions:n===110?rows().map(r=>({hash:r.transactionHash,blockHash:r.blockHash,from:owner})):[]}}
  return Response.json({jsonrpc:'2.0',id:body.id,result})
 }})
const read=async(cursor='')=>{const r=await mf.dispatchFetch('https://site/api/fragments/market'+(cursor?'?cursor='+cursor:''));return {status:r.status,body:await r.json()}}
async function start(){mf=new Miniflare(convertV4MiniflareOptions(options()));await mf.ready}
async function until(fn){for(let i=0;i<150;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100))}throw Error('Index did not catch up')}
try{
 await start();assert.equal((await read()).body.index.syncing,true)
 await until(async()=>!(await read()).body.index.syncing)
 const before=rpcCount,a=(await read()).body,b=(await read(a.nextCursor)).body,c=(await read(b.nextCursor)).body
 assert.deepEqual([a.trades.length,b.trades.length,c.trades.length],[10,10,3]);assert.equal(a.chart.length,23);assert.equal(rpcCount,before,'pages must not scan RPC')
 await mf.dispose();await start();const after=(await read()).body;assert.equal(after.trades.length,10);assert.equal(after.chart.length,23)
 // Existing shared index reorg tests cover rollback; this proves actor restart preserves the new pool's data.
 console.log(JSON.stringify({runtime:'workerd-sqlite',pageSizes:[10,10,3],restartPersisted:true,readPathRpcCalls:0,historyBeyond2000Blocks:true,productionTouched:false}))
}finally{await mf?.dispose();await rm(folder,{recursive:true,force:true})}
