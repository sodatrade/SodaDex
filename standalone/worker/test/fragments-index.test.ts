import { describe, it, expect, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { encodeAbiParameters, encodeEventTopics, parseAbiParameters, type Hex } from 'viem'
import { fragmentEvents, fragmentIndexConfig, fragmentMarket, fragmentsIndexApi } from '../src/chain-index/fragments'
import { SodaChainIndex } from '../src/chain-index/durable'
import { IndexStore } from '../src/chain-index/store'
import { scanOnce, verifyIndex } from '../src/chain-index/scan'
import { IndexRestart } from '../src/chain-index/api'
import type { Storage } from '../src/chain-index/types'
const pool = `0x${'11'.repeat(20)}`, owner = `0x${'22'.repeat(20)}` as Hex
const hash = (n: number): Hex => `0x${n.toString(16).padStart(64, '0')}`, hex = (n: number) => `0x${n.toString(16)}`
const env = { SODADEX_FRAGMENTS_DEPLOYMENT: JSON.stringify({chainId:196,pool,fromBlock:'100'}) }
function fixture() {
  const db = new DatabaseSync(':memory:') as DatabaseSync & { close(): void }
  const storage: Storage = { sql: { exec(sql, ...args) { if (!args.length && sql.includes(';')) { db.exec(sql); return { toArray: () => [] } }; return { toArray: () => db.prepare(sql).all(...args) as ReturnType<Storage['sql']['exec']> extends { toArray(): infer R } ? R : never } } },
    transactionSync(op) { db.exec('BEGIN'); try { const result = op(); db.exec('COMMIT'); return result } catch(e) { db.exec('ROLLBACK'); throw e } }, getAlarm: async () => null, setAlarm: vi.fn(async () => {}) }
  const config = fragmentIndexConfig(env), store = new IndexStore(storage,config)
  const raw = Array.from({length:23},(_,i)=>({address:pool,blockNumber:hex(110),blockHash:hash(110),transactionHash:hash(1000+i),logIndex:hex(i),removed:false,
    topics:encodeEventTopics({abi:fragmentEvents,eventName:'Swapped',args:{account:owner}}),data:encodeAbiParameters(parseAbiParameters('bool,uint256,uint256,uint256,uint256'),[i%2===0,100n,200n,3n,7n])}))
  const read: typeof fetch = vi.fn(async (_url,options)=>{
    const body=JSON.parse(String(options?.body)), n=body.params[0]==='latest'?4000:body.method==='eth_getBlockByNumber'?Number(BigInt(body.params[0])):0
    const result=body.method==='eth_chainId'?'0xc4':body.method==='eth_getLogs'?raw.filter(r=>BigInt(r.blockNumber)>=BigInt(body.params[0].fromBlock)&&BigInt(r.blockNumber)<=BigInt(body.params[0].toBlock)):
      {number:hex(n),hash:hash(n),timestamp:hex(1700000000+n),transactions:n===110?raw.map(r=>({hash:r.transactionHash,blockHash:r.blockHash,from:owner})):[]}
    return Response.json({jsonrpc:'2.0',id:body.id,result})
  })
  return {db,storage,config,store,read}
}
type Page = {trades:{id:string;input:string;shareIn:boolean}[];chart:unknown[];nextCursor:string|null;index:{syncing:boolean;lastError:string|null}}
describe('OKB fragment persistent index',()=>{
  it('indexes exact on-chain events, keeps trades older than 2000 blocks and pages 10/10/3',async()=>{
    const f=fixture();try {
      await scanOnce(f.store,f.config,f.read);await scanOnce(f.store,f.config,f.read)
      const read=(cursor='')=>fragmentMarket(new URL('https://index/market'+(cursor?'?cursor='+cursor:'')),f.store,f.config) as Page
      const a=read(),b=read(a.nextCursor!),c=read(b.nextCursor!)
      expect([a.trades.length,b.trades.length,c.trades.length]).toEqual([10,10,3]);expect(c.nextCursor).toBeNull()
      expect(new Set([...a.trades,...b.trades,...c.trades].map(t=>t.id)).size).toBe(23)
      expect(a.chart).toHaveLength(23);expect(a.trades[0].input).toBe('100');expect(a.index.syncing).toBe(false)
      const restored=new IndexStore(f.storage,f.config)
      expect((fragmentMarket(new URL('https://index/market'),restored,f.config) as Page).trades).toEqual(a.trades)
      expect(()=>fragmentMarket(new URL('https://index/market?limit=11'),restored,f.config)).toThrow('Unsupported')
    } finally {f.db.close()}
  })
  it('serves stored data even when RPC is down, without any RPC on a page request',async()=>{
    const f=fixture();try {
      await scanOnce(f.store,f.config,f.read);f.store.fail()
      const spy=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('RPC down'))
      try {
        const actor=new SodaChainIndex({storage:f.storage},env)
        const response=await actor.fetch(new Request('https://index/fragments/market'))
        const data=await response.json() as Page
        expect(response.status).toBe(200);expect(data.trades).toHaveLength(10);expect(data.index.lastError).toBeTruthy();expect(spy).not.toHaveBeenCalled();expect(f.storage.setAlarm).toHaveBeenCalled()
      } finally {spy.mockRestore()}
    } finally {f.db.close()}
  })
  it('holds pagination snapshot, invalidates old cursors after rollback, never displays orphan rows',async()=>{
    const f=fixture();try {
      await scanOnce(f.store,f.config,f.read)
      const a=fragmentMarket(new URL('https://index/market'),f.store,f.config) as Page
      const mismatch:typeof fetch=async()=>Response.json({jsonrpc:'2.0',id:1,result:{number:hex(2099),hash:hash(999),timestamp:hex(1700000000)}})
      expect(await verifyIndex(f.store,mismatch)).toBe(false)
      expect(()=>fragmentMarket(new URL('https://index/market?cursor='+a.nextCursor),f.store,f.config)).toThrow(IndexRestart)
      expect((fragmentMarket(new URL('https://index/market'),f.store,f.config) as Page).trades).toEqual([])
    } finally {f.db.close()}
  })
  it('serves pages during an alarm without replacing the running alarm',async()=>{
    const f=fixture();let release!:()=>void
    const gate=new Promise<void>(resolve=>{release=resolve})
    try {
      await scanOnce(f.store,f.config,f.read)
      const spy=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,options)=>{await gate;return f.read(input,options)})
      const actor=new SodaChainIndex({storage:f.storage},env), pending=actor.alarm()
      try {
        await vi.waitFor(()=>expect(spy).toHaveBeenCalled())
        const response=await actor.fetch(new Request('https://index/fragments/market'))
        expect(response.status).toBe(200);expect(f.storage.setAlarm).not.toHaveBeenCalled()
      } finally {release();await pending;spy.mockRestore()}
      expect(f.storage.setAlarm).toHaveBeenCalledTimes(1)
    } finally {f.db.close()}
  })
  it('rejects invalid deployment and external origins, isolates actors per deployment',async()=>{
    expect(()=>fragmentIndexConfig({...env,SODADEX_FRAGMENTS_DEPLOYMENT:'{}'})).toThrow()
    const other=fragmentIndexConfig({...env,SODADEX_FRAGMENTS_DEPLOYMENT:JSON.stringify({chainId:196,pool:owner,fromBlock:'100'})})
    expect(other.version).not.toBe(fragmentIndexConfig(env).version)
    expect((await fragmentsIndexApi(new Request('https://site/api/fragments/market',{headers:{Origin:'https://other'}}),env)).status).toBe(403)
    expect((await fragmentsIndexApi(new Request('https://site/api/fragments/market',{method:'POST'}),env)).status).toBe(405)
  })
})
