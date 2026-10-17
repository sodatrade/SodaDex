import type { Locale } from '../preferences/model'
const en = {
  market: 'Pair market', title: 'Pool price', source: 'SodaDEX test pool', pairSource: 'Pair pool · before a route quote', quoteSource: 'Current quoted route',
  noPool: 'No initialized pool for this pair.', unavailable: 'Market data unavailable.', loading: 'Reading pool market…', wrap: 'OKB / WOKB converts 1:1. No pool chart is used.',
  line: 'Line', candles: 'Candles', chartView: 'Chart view', interval: 'Candle interval', snapshot: 'Pool snapshot', scanned: 'Scanned blocks',
  observed: 'Observed trades', volume: 'Scanned volume', change: 'Observed price change', fee: 'Pool fee', noTrades: 'No swaps observed in the scanned blocks.',
  noPrices: 'No displayable prices are available for these pool records.', partial: 'Partial scan', complete: 'Requested range scanned', more: 'Load more blocks', retry: 'Retry',
  range: 'Block range', fromBlock: 'From block', toBlock: 'To block', fromDeployment: 'Deployment', latest: 'Snapshot', apply: 'Apply range', rangeError: 'Enter both block numbers, from no greater than to.',
  recent: 'Recent swaps', time: 'Time', price: 'Price', input: 'Input', output: 'Output', transaction: 'Transaction', open: 'Open', high: 'High', low: 'Low', close: 'Close',
  note: 'Real swap timestamps. Empty intervals are not filled. Scanned metrics are not 24-hour totals or independent market prices.',
  currentNote: 'The headline is the pool state at this block; chart points are observed swap prices.', pool: 'Pool', candleCount: 'Observed candles', stale: 'The scan changed or expired. Restart to read a fresh snapshot.', rangeLimit: 'This range exceeds 5,000 swaps. Choose a narrower block range.', lastScan: 'Last scanned before the error',
} as const
type Messages = Record<keyof typeof en, string>
const zh: Messages = {
  market: '交易对行情', title: '池内价格', source: 'SodaDEX 测试池', pairSource: '交易对资金池 · 尚未报价选路', quoteSource: '当前报价路径',
  noPool: '该交易对暂无已初始化的资金池。', unavailable: '行情数据暂不可用。', loading: '读取资金池行情中…', wrap: 'OKB / WOKB 按 1:1 转换，不使用资金池图表。',
  line: '曲线', candles: '蜡烛图', chartView: '图表形式', interval: '蜡烛周期', snapshot: '资金池快照', scanned: '已扫描区块',
  observed: '已观察成交', volume: '已扫描成交量', change: '已观察价格变化', fee: '资金池费率', noTrades: '已扫描区块中尚无兑换成交。',
  noPrices: '这些资金池记录暂无可显示的价格。', partial: '扫描尚未完成', complete: '请求区间已扫描完成', more: '继续加载区块', retry: '重试',
  range: '区块范围', fromBlock: '起始区块', toBlock: '结束区块', fromDeployment: '合约部署', latest: '快照区块', apply: '应用范围', rangeError: '请填写两个区块号，起始不大于结束。',
  recent: '近期兑换', time: '时间', price: '价格', input: '支付', output: '收到', transaction: '交易', open: '开', high: '高', low: '低', close: '收',
  note: '使用真实成交时间，不补造空区间。扫描统计并非 24 小时总量，也不是独立市场参考价。',
  currentNote: '顶部价格是该区块的资金池状态，图表显示已观察的成交价格。', pool: '资金池', candleCount: '已观察蜡烛', stale: '扫描已变化或过期，请重新读取快照。', rangeLimit: '此区间超过 5,000 笔兑换，请缩小区块范围。', lastScan: '失败前已扫描',
}
const yue: Messages = {
  market: '交易對行情', title: '池內價格', source: 'SodaDEX 測試池', pairSource: '交易對資金池 · 未報價揀路', quoteSource: '目前報價路徑',
  noPool: '呢個交易對未有已初始化嘅資金池。', unavailable: '行情數據暫時用唔到。', loading: '讀取資金池行情中…', wrap: 'OKB / WOKB 按 1:1 轉換，唔使用資金池圖表。',
  line: '曲線', candles: '蠟燭圖', chartView: '圖表形式', interval: '蠟燭週期', snapshot: '資金池快照', scanned: '已掃描區塊',
  observed: '已觀察成交', volume: '已掃描成交量', change: '已觀察價格變化', fee: '資金池費率', noTrades: '已掃描區塊入面未有兌換成交。',
  noPrices: '呢啲資金池記錄暫時未有可顯示嘅價格。', partial: '掃描未完成', complete: '要求區間已掃描完成', more: '繼續載入區塊', retry: '再試',
  range: '區塊範圍', fromBlock: '起始區塊', toBlock: '結束區塊', fromDeployment: '合約部署', latest: '快照區塊', apply: '套用範圍', rangeError: '請填兩個區塊號，起始唔可以大過結束。',
  recent: '近期兌換', time: '時間', price: '價格', input: '支付', output: '收到', transaction: '交易', open: '開', high: '高', low: '低', close: '收',
  note: '使用真實成交時間，唔補造空區間。掃描統計唔係 24 小時總量，亦唔係獨立市場參考價。',
  currentNote: '頂部價格係該區塊嘅資金池狀態，圖表顯示觀察到嘅成交價。', pool: '資金池', candleCount: '已觀察蠟燭', stale: '掃描已改變或者過期，請重新讀取快照。', rangeLimit: '呢個區間超過 5,000 筆兌換，請縮細區塊範圍。', lastScan: '失敗前已掃描',
}
export function tradeMarketMessages(locale: Locale): Messages { return locale === 'en' ? en : locale === 'yue-HK' ? yue : zh }
