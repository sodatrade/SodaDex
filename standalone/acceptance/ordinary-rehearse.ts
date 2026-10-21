// Final signer/nonce rehearsal, using the application's actual encoders on an owned fork.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { type Address, type Hex } from 'viem'
import config from '../../deployments/xlayer-test/active.json'
import { discoverPool } from '../web/src/liquidity/pools'
import { NATIVE_CURRENCY } from '../web/src/liquidity/config'
import { fullRange } from '../web/src/liquidity/math'
import { getPosition } from '../web/src/liquidity/positions'
import { prepareLiquidity } from '../web/src/liquidity/preview'
import { executeLiquidity } from '../web/src/liquidity/execution'
import { executePoolTrade, getPoolTradeQuote } from '../web/src/trading/poolTrade'
import type { LiquidityOperation, PublicRpc } from '../web/src/liquidity/types'
const [port, pid, file] = process.argv.slice(2)
if (!/^\d+$/.test(port ?? '') || !/^\d+$/.test(pid ?? '') || !file) throw Error('Explicit owned fork and output required')
const owner = config.owner as Address
const fab = { address: '0x842b7bf61f2cb4be8aacac6adece3244c2a6f6ab' as Address, native:false, decimals:8, symbol:'TEST-FAB', name:'TEST-FAB' }
const rows: Record<string, unknown>[] = []
let label = ''
let maximumFab = 0n
const read: PublicRpc = async (method, params = []) => {
  if (execFileSync('lsof',['-nP',`-iTCP@127.0.0.1:${port}`,'-sTCP:LISTEN','-t'],{encoding:'utf8'}).trim() !== pid) throw Error('Owned fork listener changed')
  const result = await (await fetch(`http://127.0.0.1:${port}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(60000)})).json()
  if (result.error) throw Error(`${method}: ${JSON.stringify(result.error)}`)
  return result.result
}
const wait = async (_read: PublicRpc, hash: Hex): Promise<void> => {
  const receipt = await read('eth_getTransactionReceipt',[hash]) as {status:string}
  if (receipt?.status !== '0x1') throw Error('Owned rehearsal did not mine successfully')
}
if (!String(await read('web3_clientVersion')).toLowerCase().includes('anvil') || await read('eth_chainId') !== '0xc4') throw Error('Owned chain-196 Anvil required')
const startNonce=Number(BigInt(await read('eth_getTransactionCount',[owner,'latest']) as string))
const initialBlock=String(await read('eth_blockNumber'))
await read('evm_setNextBlockTimestamp',[Math.floor(Date.now()/1000)])
await read('evm_mine')
const runtimeHashes: Record<string,string> = {}
for (const address of [...Object.values(config.contracts), config.wrappedNative,config.permit2,fab.address]) {
 const code=await read('eth_getCode',[address,'latest']) as string
 if(code==='0x')throw Error('Missing TEST runtime')
 runtimeHashes[address.toLowerCase()]=createHash('sha256').update(Buffer.from(code.slice(2),'hex')).digest('hex')
}
const provider = { request: async ({method,params}:{method:string;params?:unknown[]}):Promise<unknown> => {
  if(method==='eth_accounts')return [owner]
  if(method==='eth_chainId')return '0xc4'
  if(method!=='eth_sendTransaction')throw Error('Rehearsal wallet method blocked')
  const tx=(params as Record<string,unknown>[])[0]
  const gas=BigInt(await read('eth_estimateGas',[{from:tx.from,to:tx.to,data:tx.data,value:tx.value}]) as string)
  const hash=await read(method,[{...tx,gas:'0x'+(gas*110n/100n+1n).toString(16),gasPrice:'0x1406f40'}]) as Hex
  await read('evm_mine')
  await wait(read,hash)
  const receipt=await read('eth_getTransactionReceipt',[hash]) as {gasUsed:string;effectiveGasPrice:string}
  const tokenSpend = [fab.address,config.permit2].some(a=>a.toLowerCase()===String(tx.to).toLowerCase()) ? 0n : maximumFab
  rows.push({label,to:tx.to,data:tx.data,value:String(BigInt(tx.value as string ?? '0x0')),maximumFabSpendRaw:String(tokenSpend),gasEstimate:String(gas),plannedGasLimit:String(gas*110n/100n+1n),hash,gasUsed:String(BigInt(receipt.gasUsed)),feeWei:String(BigInt(receipt.gasUsed)*BigInt(receipt.effectiveGasPrice))})
  return hash
} }
const identity={address:owner,chainId:196,revision:1,provider}
const context={identity,getIdentity:()=>identity,onProgress:()=>{},read,wait,isCurrentForm:()=>true}
const liquidity=async(operation:LiquidityOperation):Promise<Hex>=>{
 const preview=await prepareLiquidity(operation,owner,read)
 maximumFab=preview.pool.currency0.native?preview.maximum1:preview.maximum0
 return executeLiquidity(preview,context)
}
const results=[]
for (const protocol of ['v3','v4'] as const) {
 const draft={protocol,currencyA:NATIVE_CURRENCY,currencyB:fab,fee:500,tickSpacing:10}
 const empty=await discoverPool(draft,read)
 if(empty.initialized)throw Error('Rehearsal requires a fresh TEST pair')
 label=protocol+':create-and-first-add'
 const hash=await liquidity({kind:'mint',pool:empty,initialPrice:protocol==='v3'?'0.00000001':'100000000',...fullRange(10),amount0:empty.currency0.native?900000000000n:9000000000n,amount1:empty.currency1.native?900000000000n:9000000000n})
 const receipt=await read('eth_getTransactionReceipt',[hash]) as {logs:{address:string;topics:string[]}[]}
 const manager=config.contracts[protocol==='v3'?'v3PositionManager':'v4PositionManager']
 const minted=receipt.logs.find(l=>l.address.toLowerCase()===manager.toLowerCase()&&l.topics.length===4&&BigInt(l.topics[1])===0n)
 if(!minted)throw Error('Missing NFT mint')
 const tokenId=BigInt(minted.topics[3]);let position=await getPosition(protocol,tokenId,read)
 if(position.liquidity<=0n)throw Error('Empty mint')
 label=protocol+':increase'
 await liquidity({kind:'increase',position,amount0:empty.currency0.native?90000000000n:900000000n,amount1:empty.currency1.native?90000000000n:900000000n})
 let pool=await discoverPool(draft,read)
 for(const nativeIn of [true,false]) {
  label=protocol+':'+(nativeIn?'okb-to-token':'token-to-okb')
  maximumFab=nativeIn?0n:10000000n
  await executePoolTrade(await getPoolTradeQuote(pool,nativeIn?pool.currency0.native:!pool.currency0.native,nativeIn?10000000000n:10000000n,50,read),context)
  pool=await discoverPool(draft,read)
 }
 for(const bps of [5000,10000]) {
  label=protocol+':'+(bps===5000?'remove-half':'remove-all')
  position=await getPosition(protocol,tokenId,read)
  await liquidity({kind:'decrease',position,liquidity:0n,liquidityBps:bps})
 }
 position=await getPosition(protocol,tokenId,read)
 if(position.liquidity!==0n||position.owner.toLowerCase()!==owner.toLowerCase())throw Error('Final NFT invariant')
 results.push({protocol,tokenId:String(tokenId),remainingLiquidity:'0',poolId:pool.id})
}
const native=rows.reduce((s,r)=>s+BigInt(r.value as string),0n),maxGas=rows.reduce((s,r)=>s+BigInt(r.plannedGasLimit as string)*30000000n,0n),fabMaximum=rows.reduce((s,r)=>s+BigInt(r.maximumFabSpendRaw as string),0n)
console.error(JSON.stringify({transactions:rows.length,native:String(native),maximumGas:String(maxGas),maximumFabRaw:String(fabMaximum)}))
if(rows.length>28||native>2100000000000n||maxGas>317900000000000n||native+maxGas>320000000000000n||fabMaximum>20000000000n)throw Error('Final rehearsal exceeds approved caps')
fs.writeFileSync(file,JSON.stringify({mode:'owned-final-signer-fork',chainId:196,owner,startNonce,initialBlock,publicChainWrites:0,runtimeHashes,results,rows,maximumGasFeeWei:String(maxGas),grossNativeValueWei:String(native)},null,2)+'\n')
console.log(JSON.stringify({transactions:rows.length,startNonce,maximumGasFeeWei:String(maxGas),grossNativeValueWei:String(native),results,publicChainWrites:0}))
