import { decodeFunctionResult, encodeFunctionData, type Abi, type Address, type Hex } from 'viem'
import { record } from './contracts'
export const RPC_URL = 'https://rpc.ignix.bot/rpc/196'
export class RpcUnavailable extends Error {}
export async function rpc(method: string, params: unknown[], upstreamFetch: typeof fetch = fetch): Promise<unknown> {
  const response = await upstreamFetch(RPC_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'SodaDex/1.0' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), redirect: 'manual', signal: AbortSignal.timeout(12_000) })
  if (!response.ok) throw new RpcUnavailable('RPC temporarily unavailable')
  const body: unknown = await response.json()
  if (!record(body) || body.jsonrpc !== '2.0' || body.id !== 1 || !Object.hasOwn(body, 'result') || Object.hasOwn(body, 'error')) throw new RpcUnavailable('RPC call failed')
  return body.result
}
export async function call(abi: Abi, to: string, functionName: string, args: readonly unknown[] = [], block = 'latest', upstreamFetch: typeof fetch = fetch): Promise<unknown> {
  const data = encodeFunctionData({ abi, functionName, args })
  const result = await rpc('eth_call', [{ to: to as Address, data }, block], upstreamFetch)
  if (typeof result !== 'string' || !/^0x[0-9a-fA-F]*$/.test(result)) throw new RpcUnavailable('Invalid contract result')
  return decodeFunctionResult({ abi, functionName, data: result as Hex })
}
