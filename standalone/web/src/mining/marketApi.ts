import type { MiningProductDeployment } from '../../../mining-products'
import { MINING_MARKET_INTERVALS, type MiningMarketCandle, type MiningMarketInterval, type MiningMarketTrade } from '../../../mining-market'
import { indexBlock, validIndexStatus, type ChainIndexStatus, type IndexBlock } from '../data/indexStatus'
import { apiPath } from '../lib/apiPath'
import { MiningIndexError } from './indexApi'
export interface MiningMarketPage {
  schemaVersion: 1; chainId: number; deploymentVersion: string; token: string; interval: MiningMarketInterval
  asOf: IndexBlock | null; index: ChainIndexStatus; candles: MiningMarketCandle[]; trades: MiningMarketTrade[]
  nextCursor: string | null; total: number; historyLimited: boolean
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const uint = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0
const price = (v: unknown): v is string => typeof v === 'string' && /^\d+\.\d{36}$/.test(v) && Number.isFinite(Number(v)) && Number(v) > 0
const raw = (v: unknown): boolean => typeof v === 'string' && /^\d{1,78}$/.test(v)
const hash = (v: unknown): boolean => typeof v === 'string' && /^0x[\da-f]{64}$/i.test(v)
export async function loadMiningMarket(d: MiningProductDeployment, token: string, interval: MiningMarketInterval, cursor?: string, signal?: AbortSignal): Promise<MiningMarketPage> {
  const params = new URLSearchParams({ token, interval, ...(cursor ? { cursor } : {}) })
  const response = await fetch(apiPath(`/api/index/market?${params}`), { signal, cache: 'no-store', credentials: 'same-origin' })
  if (!response.ok) throw new MiningIndexError(response.status === 409)
  const v: unknown = await response.json()
  if (!record(v) || v.schemaVersion !== 1 || v.chainId !== d.chainId || v.deploymentVersion !== d.version || v.token !== token.toLowerCase() || v.interval !== interval ||
    !indexBlock(v.asOf) || !validIndexStatus(v.index, d.chainId, d.version) || !uint(v.total) || typeof v.historyLimited !== 'boolean' ||
    !(v.nextCursor === null || typeof v.nextCursor === 'string' && /^[\da-f-]{36}$/i.test(v.nextCursor)) ||
    !Array.isArray(v.trades) || v.trades.length > 10 || !Array.isArray(v.candles) || v.candles.length > 5000) throw new MiningIndexError(false)
  const through = v.index.indexedThrough
  if (!v.trades.every(t => record(t) && typeof t.id === 'string' && hash(t.transactionHash) && uint(t.timestamp) && t.timestamp <= 8_640_000_000_000 &&
    uint(t.blockNumber) && t.blockNumber <= through && ['curve', 'pair', 'fragments'].includes(String(t.source)) && typeof t.buy === 'boolean' && raw(t.assetRaw) && raw(t.fabRaw) && price(t.price)) ||
    !v.candles.every((c, i, all) => record(c) && uint(c.time) && c.time <= 8_640_000_000_000 && c.time % MINING_MARKET_INTERVALS[interval] === 0 && uint(c.trades) && c.trades > 0 &&
      [c.open, c.high, c.low, c.close].every(price) && Number(c.high) >= Math.max(Number(c.open), Number(c.close)) && Number(c.low) <= Math.min(Number(c.open), Number(c.close)) &&
      (i === 0 || c.time > all[i - 1].time)) || new Set(v.trades.map(t => t.id)).size !== v.trades.length) throw new MiningIndexError(false)
  return v as unknown as MiningMarketPage
}
