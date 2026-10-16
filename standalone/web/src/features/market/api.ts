export interface ChainBlock { number: number; hash: string; timestamp: number }
export interface Coverage { fromBlock: number; toBlock: number; complete: boolean; nextFromBlock: number | null }
export interface DexPool {
  protocol: 'v3' | 'v4'; id: string; address: string | null; token0: string; token1: string
  fee: number; tickSpacing: number; hooks: string; createdBlock: number | null; source: 'manifest' | 'chain'
  sqrtPriceX96: string | null; tick: number | null; liquidity: string | null; stateError: string | null
}
export interface DexToken { address: string; symbol: string | null; name: string | null; decimals: number | null }
export interface DexEvent {
  id: string; protocol: 'v3' | 'v4'; address: string; event: string; blockNumber: number; blockHash: string
  transactionHash: string; logIndex: number; args: Record<string, string | number | boolean>; transactionFrom: string | null
}
export interface PoolsResponse { schemaVersion: 1; chainId: 196; asOf: ChainBlock; coverage: Coverage; pools: DexPool[] }
export interface EventsResponse { schemaVersion: 1; chainId: 196; asOf: ChainBlock; coverage: Coverage; events: DexEvent[]; nextCursor: string | null }
export interface MarketResponse {
  schemaVersion: 1; chainId: 196; asOf: ChainBlock; coverage: Coverage; pool: DexPool; token0: DexToken; token1: DexToken
  priceToken1PerToken0: string | null; volume: { token0Raw: string; token1Raw: string }
  fees: { token0Raw: string | null; token1Raw: string | null; reason: string | null }
  reserves: { token0Raw: string | null; token1Raw: string | null; reason: string | null }
  tvlUsd: null; apr: null; unavailableReasons: string[]
  priceHistory: { blockNumber: number; logIndex: number; sqrtPriceX96: string }[]
}
export interface EventQuery { fromBlock?: number; toBlock?: number; owner?: string; cursor?: string }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const hash = (v: unknown): v is string => typeof v === 'string' && /^0x[\da-f]{64}$/i.test(v)
const address = (v: unknown): v is string => typeof v === 'string' && /^0x[\da-f]{40}$/i.test(v)
const raw = (v: unknown): boolean => typeof v === 'string' && /^\d+$/.test(v)
function envelope(v: unknown): v is Record<string, unknown> {
  if (!record(v) || v.schemaVersion !== 1 || v.chainId !== 196 || !record(v.asOf) || !record(v.coverage)) return false
  return integer(v.asOf.number) && hash(v.asOf.hash) && integer(v.asOf.timestamp) &&
    integer(v.coverage.fromBlock) && integer(v.coverage.toBlock) && typeof v.coverage.complete === 'boolean' &&
    (v.coverage.nextFromBlock === null || integer(v.coverage.nextFromBlock))
}
function pool(v: unknown): boolean {
  return record(v) && ['v3', 'v4'].includes(String(v.protocol)) && (hash(v.id) || address(v.id)) &&
    address(v.token0) && address(v.token1) && integer(v.fee) && integer(v.tickSpacing) &&
    (v.sqrtPriceX96 === null || raw(v.sqrtPriceX96)) && (v.liquidity === null || raw(v.liquidity))
}
function token(v: unknown): boolean {
  return record(v) && address(v.address) && (v.symbol === null || typeof v.symbol === 'string') &&
    (v.decimals === null || (integer(v.decimals) && v.decimals <= 255))
}
async function get(path: string): Promise<unknown> {
  const response = await fetch(path, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error('Data unavailable')
  return response.json() as Promise<unknown>
}
export async function getPools(): Promise<PoolsResponse> {
  const v = await get('/api/dex/pools')
  if (!envelope(v) || !Array.isArray(v.pools) || !v.pools.every(pool)) throw new Error('Invalid pool data')
  return v as unknown as PoolsResponse
}
export async function getMarket(p: DexPool): Promise<MarketResponse> {
  const params = new URLSearchParams({ pool: p.id, protocol: p.protocol, token0: p.token0, token1: p.token1,
    fee: String(p.fee), tickSpacing: String(p.tickSpacing), hooks: p.hooks })
  const v = await get(`/api/dex/market?${params}`)
  if (!envelope(v) || !pool(v.pool) || !token(v.token0) || !token(v.token1) ||
    !record(v.volume) || !raw(v.volume.token0Raw) || !raw(v.volume.token1Raw) || !record(v.fees) || !record(v.reserves) ||
    !Array.isArray(v.unavailableReasons) || !v.unavailableReasons.every((r) => typeof r === 'string') ||
    !Array.isArray(v.priceHistory) || !v.priceHistory.every((p) => record(p) && integer(p.blockNumber) && integer(p.logIndex) && raw(p.sqrtPriceX96)) ||
    !(v.priceToken1PerToken0 === null || (typeof v.priceToken1PerToken0 === 'string' && /^\d+(\.\d+)?$/.test(v.priceToken1PerToken0))))
    throw new Error('Invalid market data')
  return v as unknown as MarketResponse
}
export async function getEvents(query: EventQuery): Promise<EventsResponse> {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value))
  const v = await get(`/api/dex/events?${params}`)
  if (!envelope(v) || !Array.isArray(v.events) || !(v.nextCursor === null || typeof v.nextCursor === 'string') ||
    !v.events.every((e) => record(e) && hash(e.transactionHash) && hash(e.blockHash) && integer(e.blockNumber) &&
      integer(e.logIndex) && typeof e.id === 'string' && typeof e.event === 'string' && record(e.args)))
    throw new Error('Invalid event data')
  return v as unknown as EventsResponse
}
/** New canonical observations replace all events at a reorganized height. */
export function mergeEvents(pages: EventsResponse[]): DexEvent[] {
  const canonical = new Map<number, string>()
  for (const page of pages) for (const e of page.events) canonical.set(e.blockNumber, e.blockHash)
  const events = new Map<string, DexEvent>()
  for (const page of pages) for (const e of page.events)
    if (e.blockHash === canonical.get(e.blockNumber)) events.set(e.id, e)
  return [...events.values()].sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex)
}
