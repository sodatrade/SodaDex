// The official test RPC can intermittently serve an obsolete pending backend.
// Only reads are retried. A submission is sent exactly once by this transport.
export const MINING_PUBLIC_RPC = 'https://testrpc.xlayer.tech/terigon'
const METHODS = new Set(['eth_chainId', 'web3_clientVersion', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode', 'eth_getStorageAt',
  'eth_getTransactionCount', 'eth_call', 'eth_estimateGas', 'eth_gasPrice', 'eth_getBalance', 'eth_getTransactionReceipt', 'eth_sendRawTransaction'])
const quantity = (value) => {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) throw new Error('Invalid public RPC quantity')
  return BigInt(value)
}
function freshHeaders(latest, pending) {
  return latest && pending && quantity(pending.number) >= quantity(latest.number) && quantity(pending.timestamp) >= quantity(latest.timestamp)
}

export class VerifiedMiningRpc {
  constructor(owner, fetcher = fetch, attempts = 6) { this.owner = owner; this.fetcher = fetcher; this.attempts = attempts }
  async post(request) {
    const response = await this.fetcher(MINING_PUBLIC_RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request), signal: AbortSignal.timeout(20_000) })
    if (!response.ok) throw new Error('Public 1952 RPC transport failed')
    return response.json()
  }
  async request(method, params = []) {
    if (!METHODS.has(method)) throw new Error('Public execution rejects non-reviewed RPC methods')
    if (!params.includes('pending')) {
      const body = await this.post({ jsonrpc: '2.0', id: 1952, method, params })
      if (body.id !== 1952 || body.jsonrpc !== '2.0' || body.error) throw new Error(`Public 1952 ${method} failed`)
      return body.result
    }
    for (let attempt = 0; attempt < this.attempts; attempt++) {
      const probes = [
        ['eth_chainId', []], ['eth_getBlockByNumber', ['latest', false]], ['eth_getBlockByNumber', ['pending', false]],
        ['eth_getTransactionCount', [this.owner, 'latest']], ['eth_getTransactionCount', [this.owner, 'pending']],
      ]
      const target = ['eth_call', 'eth_estimateGas'].includes(method) ? params[0]?.to : undefined
      if (target) probes.push(['eth_getCode', [target, 'latest']], ['eth_getCode', [target, 'pending']])
      const ownerBalance = method === 'eth_getBalance' && params[0]?.toLowerCase() === this.owner.toLowerCase()
      if (ownerBalance) probes.push(['eth_getBalance', [this.owner, 'latest']])
      const operations = [...probes, [method, params]]
      let bodies
      try { bodies = await this.post(operations.map(([m, p], id) => ({ jsonrpc: '2.0', id, method: m, params: p }))) }
      catch { continue }
      if (!Array.isArray(bodies) || bodies.length !== operations.length) continue
      const results = new Map(bodies.map((body) => [body.id, body]))
      if (results.size !== operations.length || operations.some((_, id) => results.get(id)?.jsonrpc !== '2.0')) continue
      if (probes.some((_, id) => results.get(id)?.error)) continue
      const values = probes.map((_, id) => results.get(id).result)
      if (values[0] !== '0x7a0') throw new Error('Public pending snapshot is not chain1952')
      if (!freshHeaders(values[1], values[2])) continue
      if (quantity(values[4]) < quantity(values[3])) continue
      if (quantity(values[4]) > quantity(values[3])) throw new Error('Owner has an unconfirmed transaction; reconcile nonce before continuing')
      if (target && (typeof values[5] !== 'string' || values[5] !== values[6])) continue
      const result = results.get(probes.length)
      if (result.error) throw new Error(`Public 1952 ${method} failed on a fresh snapshot`)
      if (method === 'eth_getBlockByNumber' && !freshHeaders(values[1], result.result)) continue
      if (method === 'eth_getTransactionCount' && params[0]?.toLowerCase() === this.owner.toLowerCase() && quantity(result.result) !== quantity(values[3])) continue
      if (ownerBalance && quantity(result.result) < quantity(values.at(-1))) continue
      return result.result
    }
    throw new Error('Public pending snapshot stayed stale or unavailable; no submission was retried')
  }
}
