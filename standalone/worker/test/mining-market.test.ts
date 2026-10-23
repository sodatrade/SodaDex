import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { miningCandles } from '../../mining-market'
import { MINING_PRODUCTS } from '../../mining-products'
import { baseConfig } from '../src/chain-index/config'
import { IndexStore } from '../src/chain-index/store'
import { miningMarket, miningMarketTrade } from '../src/chain-index/mining-market'
import type { IndexedEvent, Storage } from '../src/chain-index/types'
if (MINING_PRODUCTS.state !== 'ready') throw Error('Missing test fixture')
const d = MINING_PRODUCTS
const token = `0x${'01'.repeat(20)}`, pair = `0x${'02'.repeat(20)}`, hash = `0x${'11'.repeat(32)}` as const
function event(index: number, name: string, address: string, args: IndexedEvent['args']): IndexedEvent {
  return { id: `${hash}:${index}`, protocol: 'mining', event: name, address, args, blockNumber: Number(d.state === 'ready' ? d.genesisBlock : 0), blockHash: hash, transactionHash: hash, logIndex: index, transactionFrom: token, timestamp: 1700000000 + index * 60 }
}
function fixture() {
  const db = new DatabaseSync(':memory:'), config = baseConfig('1952-mining-test')
  const storage: Storage = { sql: { exec(sql, ...args) { if (!args.length && sql.includes(';')) { db.exec(sql); return { toArray: () => [] } }; return { toArray: () => db.prepare(sql).all(...args) as ReturnType<Storage['sql']['exec']> extends { toArray(): infer R } ? R : never } } }, transactionSync: fn => fn(), getAlarm: async () => null, setAlarm: async () => {} }
  const store = new IndexStore(storage, config), block = { number: config.fromBlock, hash, timestamp: 1700002000 }
  const events = [event(0, 'TokenCreated', d.contracts.manager.address, { token, quote: d.contracts.fab.address }), event(1, 'GraduatedV2', d.contracts.manager.address, { token, pair }),
    ...Array.from({ length: 23 }, (_, i) => event(i + 2, 'Trade', d.contracts.manager.address, { token, isBuy: i % 2 === 0, tokenAmount: '1000000000000000000', curveQuoteAmount: String((i + 1) * 100000000) })),
    event(25, 'Swapped', d.contracts.fragmentPool.address, { shareIn: false, input: '100000000', output: '1000000000000000000' }),
    event(26, 'Swapped', d.contracts.fragmentPool.address, { shareIn: true, input: '1000000000000000000', output: '200000000' }),
    event(27, 'Trade', d.contracts.manager.address, { token: pair, isBuy: true, tokenAmount: '1000000000000000000', curveQuoteAmount: '100000000' })]
  store.commit({ from: config.fromBlock, to: block, head: block, events, logs: events.map(() => ({ address: token, topics: [hash], data: '0x', blockNumber: '0x1', blockHash: hash, transactionHash: hash, logIndex: '0x0' })), pools: [] })
  const read = (asset = token, cursor = '') => miningMarket(new URL(`https://index/market?token=${asset}&interval=5m${cursor ? '&cursor=' + cursor : ''}`), store, config) as { trades: ReturnType<typeof miningMarketTrade>[]; nextCursor: string | null; total: number; candles: unknown[] }
  return { store, config, read, block }
}
describe('mining indexed markets', () => {
  it('isolates projects and returns full candles with ten-row stable history pages', () => {
    const f = fixture(), first = f.read()
    expect(first.total).toBe(23); expect(first.trades).toHaveLength(10); expect(first.trades[0].price).toBe('23.' + '0'.repeat(36))
    expect(first.candles.length).toBeGreaterThan(1)
    f.store.commit({ from: f.block.number + 1, to: { ...f.block, number: f.block.number + 1 }, head: { ...f.block, number: f.block.number + 1 }, events: [], logs: [], pools: [] })
    const second = f.read(token, first.nextCursor!), third = f.read(token, second.nextCursor!)
    expect(second.trades).toHaveLength(10); expect(third.trades).toHaveLength(3); expect(third.nextCursor).toBeNull()
    expect(new Set([...first.trades, ...second.trades, ...third.trades].map(t => t.id)).size).toBe(23)
    expect(() => f.read(d.contracts.fragmentVault.address, first.nextCursor!)).toThrow('Index changed')
    f.store.rollback(); expect(() => f.read(token, first.nextCursor!)).toThrow('Index changed')
  })
  it('uses correct decimals and direction for fragments and V2 on either token ordering', () => {
    const f = fixture(), fragment = f.read(d.contracts.fragmentVault.address)
    expect(fragment.total).toBe(2); expect(fragment.trades.map(t => t.buy)).toEqual([false, true])
    expect(fragment.trades.map(t => Number(t.price))).toEqual([2, 1])
    for (const asset of [token, `0x${'ff'.repeat(20)}`]) {
      const zero = BigInt(asset) < BigInt(d.contracts.fab.address)
      const args = { amount0In: '0', amount1In: '0', amount0Out: '0', amount1Out: '0', [zero ? 'amount0Out' : 'amount1Out']: '1000000000000000000', [zero ? 'amount1In' : 'amount0In']: '300000000' }
      const trade = miningMarketTrade(event(1, 'Swap', pair, args), asset, d.contracts.fab.address)
      expect(trade.buy).toBe(true); expect(Number(trade.price)).toBe(3)
    }
  })
  it('does not fabricate candles for empty intervals and preserves exact OHLC order', () => {
    const a = miningMarketTrade(event(0, 'Swapped', pair, { shareIn: false, input: '100000000', output: '1000000000000000000' }), token, d.contracts.fab.address)
    const candles = miningCandles([a, { ...a, timestamp: a.timestamp + 1, price: '2.' + '0'.repeat(36) }, { ...a, timestamp: a.timestamp + 3600 }], '5m')
    expect(candles).toHaveLength(2); expect(candles[0]).toMatchObject({ open: a.price, low: a.price, high: '2.' + '0'.repeat(36), close: '2.' + '0'.repeat(36), trades: 2 })
    expect(() => fixture().read(pair)).toThrow('not indexed')
  })
})
