import { decodeFunctionData, encodeFunctionData, isAddress, type Abi, type Hex } from 'viem'
import { poolAbi, tokenAbi, lpRewardsAbi, ignixIncomeAbi } from '../../web/src/fragments/abi'
import { RPC_URL } from './upstream'
type Manifest = { chainId: number; pool: string; vault: string; rewards: string; income?: string; ignixTreasury?: string }
const record = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const block = (x: unknown): x is string => typeof x === 'string' && /^(latest|pending|safe|finalized|0x[0-9a-fA-F]+)$/.test(x)
const hex = (x: unknown): x is Hex => typeof x === 'string' && /^0x(?:[0-9a-fA-F]{2})*$/.test(x)
const same = (a: unknown, b: string): boolean => typeof a === 'string' && a.toLowerCase() === b.toLowerCase()
export function fragmentManifest(raw?: string): Manifest | undefined {
  if (!raw) return undefined
  try {
    const x: unknown = JSON.parse(raw)
    if (!record(x) || x.chainId !== 196 || ![x.pool,x.vault,x.rewards].every(a=>typeof a === 'string' && isAddress(a) && BigInt(a)!==0n)) return undefined
    if ((x.income !== undefined || x.ignixTreasury !== undefined) && ![x.income,x.ignixTreasury].every(a=>typeof a === 'string' && isAddress(a) && BigInt(a)!==0n)) return undefined
    return x as Manifest
  } catch { return undefined }
}
export function validFragmentRpc(method: unknown, params: unknown, m: Manifest): boolean {
  if (!Array.isArray(params)) return false
  if (['eth_chainId','eth_blockNumber','eth_gasPrice'].includes(String(method))) return params.length === 0
  if (method === 'eth_getTransactionReceipt') return params.length===1 && typeof params[0]==='string' && /^0x[0-9a-fA-F]{64}$/.test(params[0])
  if (method === 'eth_getBlockByNumber') return params.length===2 && block(params[0]) && params[1]===false
  if (method === 'eth_getBalance') return params.length===2 && typeof params[0]==='string' && isAddress(params[0]) && block(params[1])
  if (method === 'eth_getLogs') {
    const f=params[0]
    if(params.length!==1||!record(f)||!same(f.address,m.pool)||Object.keys(f).some(k=>!['address','fromBlock','toBlock','topics'].includes(k))||typeof f.fromBlock!=='string'||typeof f.toBlock!=='string'||!/^0x[0-9a-fA-F]+$/.test(f.fromBlock)||!/^0x[0-9a-fA-F]+$/.test(f.toBlock)) return false
    const width=BigInt(f.toBlock)-BigInt(f.fromBlock)
    return width>=0n&&width<=2000n&&Array.isArray(f.topics)&&f.topics.length<=3&&f.topics.every(t=>t===null||typeof t==='string'&&/^0x[0-9a-fA-F]{64}$/.test(t))
  }
  if (!['eth_call','eth_estimateGas'].includes(String(method)) || params.length<1 || params.length>2 || params.length===2&&!block(params[1])) return false
  const t=params[0]
  if(!record(t)||!hex(t.data)||Object.keys(t).some(k=>!['from','to','data','value','gas','gasPrice','maxFeePerGas','maxPriorityFeePerGas'].includes(k))) return false
  if(t.from!==undefined&&(typeof t.from!=='string'||!isAddress(t.from))) return false
  if(['value','gas','gasPrice','maxFeePerGas','maxPriorityFeePerGas'].some(k=>t[k]!==undefined&&(typeof t[k]!=='string'||!/^0x[0-9a-fA-F]{1,64}$/.test(t[k] as string)))) return false
  const abi: Abi = same(t.to,m.pool)?[...poolAbi,...tokenAbi]:same(t.to,m.vault)?tokenAbi:same(t.to,m.rewards)?lpRewardsAbi:m.income&&same(t.to,m.income)?ignixIncomeAbi:[]
  try {
    const decoded=decodeFunctionData({abi,data:t.data})
    if(encodeFunctionData({abi,functionName:decoded.functionName,args:decoded.args}).toLowerCase()!==t.data.toLowerCase())return false
    const item=abi.find(x=>x.type==='function'&&x.name===decoded.functionName)
    if(!item||item.type!=='function')return false
    if(item.stateMutability==='view'||item.stateMutability==='pure')return BigInt(String(t.value??'0x0'))===0n
    if(!t.from)return false
    if(decoded.functionName==='approve')return same(t.to,m.vault)&&same(decoded.args?.[0],m.pool)&&BigInt(String(t.value??'0x0'))===0n
    return same(t.to,m.pool)&&['swap','addLiquidity','removeLiquidity'].includes(decoded.functionName)
  } catch { return false }
}
const error=(id: unknown,message: string,status=400)=>Response.json({jsonrpc:'2.0',id,error:{code:-32600,message}},{status,headers:{'Cache-Control':'no-store'}})
export async function fragmentsRpc(request: Request, raw?: string, upstream: typeof fetch = fetch): Promise<Response> {
  const m=fragmentManifest(raw)
  if(!m)return error(null,'Fragment deployment unavailable',503)
  if(request.method!=='POST')return error(null,'POST required',405)
  const origin=request.headers.get('Origin')
  if(origin&&origin!==new URL(request.url).origin)return error(null,'Origin not allowed',403)
  if(!request.headers.get('Content-Type')?.includes('application/json'))return error(null,'JSON required',415)
  const reader=request.body?.getReader();if(!reader)return error(null,'Body required')
  const chunks: Uint8Array[]=[];let size=0
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384){await reader.cancel();return error(null,'Request too large',413)}chunks.push(value)}
  const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length}
  let body: unknown;try{body=JSON.parse(new TextDecoder().decode(bytes))}catch{return error(null,'Invalid JSON')}
  if(!record(body)||body.jsonrpc!=='2.0'||!(typeof body.id==='number'&&Number.isSafeInteger(body.id)||typeof body.id==='string'&&body.id.length<=64)||!validFragmentRpc(body.method,body.params??[],m))return error(null,'Unsupported fragment read')
  try {
    const response=await upstream(RPC_URL,{method:'POST',headers:{'Content-Type':'application/json','User-Agent':'SodaDex/1.0'},body:JSON.stringify({...body,params:body.params??[]}),signal:AbortSignal.timeout(20000),redirect:'manual'})
    if(!response.ok)return error(body.id,`RPC temporarily unavailable (HTTP ${response.status})`,502)
    const result: unknown=await response.json()
    if(!record(result)||result.jsonrpc!=='2.0'||result.id!==body.id||(!('result' in result)&&!('error' in result)))return error(body.id,'Invalid upstream response',502)
    if(body.method==='eth_chainId'&&result.result!=='0xc4')return error(body.id,'Wrong chain',502)
    return Response.json(result,{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})
  }catch{return error(body.id,'RPC temporarily unavailable',502)}
}
