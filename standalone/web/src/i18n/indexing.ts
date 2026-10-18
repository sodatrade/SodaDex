import type { Locale } from '../preferences/model'

const zh = {
  all: '全部链上记录',
  chain: '链上记录', local: '本机提交', note: '读取 1952 测试合约的链上事件。每页最多 10 条，一笔交易可能产生多个事件。',
  loading: '正在读取链上记录…', unavailable: '暂时无法读取索引，请稍后重试。本机提交记录仍可查询。',
  empty: '当前筛选范围内暂无已收录的事件。', syncing: '正在同步链上记录', synced: '已同步', through: '已收录至区块',
  head: '链上区块', lag: '同步暂缓，展示已收录记录', retry: '刷新', previous: '上一页', next: '下一页', page: '页',
  restart: '链上数据已更新，请刷新后重新翻页。', details: '事件详情', connect: '连接 1952 钱包后可筛选自己的记录。',
}
const en: typeof zh = {
  all: 'All onchain activity',
  chain: 'Onchain activity', local: 'This device', note: 'Events from the 1952 test contracts. Up to 10 per page; one transaction can emit several events.',
  loading: 'Loading onchain activity…', unavailable: 'The index is temporarily unavailable. You can still check submissions from this device.',
  empty: 'No indexed events match this filter yet.', syncing: 'Syncing onchain activity', synced: 'Synced', through: 'Indexed through block',
  head: 'Chain block', lag: 'Sync delayed; showing indexed activity', retry: 'Refresh', previous: 'Previous', next: 'Next', page: 'Page',
  restart: 'Chain data changed. Refresh to restart pagination.', details: 'Event details', connect: 'Connect a wallet on 1952 to filter your activity.',
}
const yue: typeof zh = {
  all: '全部鏈上紀錄',
  chain: '鏈上紀錄', local: '本機提交', note: '讀取 1952 測試合約嘅鏈上事件。每頁最多 10 項，一筆交易可能有幾個事件。',
  loading: '讀取鏈上紀錄中…', unavailable: '暫時讀唔到索引，請稍後再試。本機提交紀錄仍然可以查。',
  empty: '目前篩選範圍未有已收錄嘅事件。', syncing: '同步鏈上紀錄中', synced: '已同步', through: '已收錄至區塊',
  head: '鏈上區塊', lag: '同步暫緩，顯示已收錄紀錄', retry: '重新整理', previous: '上一頁', next: '下一頁', page: '頁',
  restart: '鏈上資料已更新，請重新整理再翻頁。', details: '事件詳情', connect: '連接 1952 銀包後可以篩選自己嘅紀錄。',
}
export const indexMessages = (locale: Locale): typeof zh => locale === 'en' ? en : locale === 'yue-HK' ? yue : zh

const eventNames: Record<string, readonly [string, string, string]> = {
  Swapped: ['碎片兑换', 'Fragment swap', '碎片兌換'], Swap: ['代币兑换', 'Token swap', '代幣兌換'],
  Trade: ['项目代币交易', 'Project trade', '項目代幣交易'], Deposited: ['存入矿机', 'Miner deposited', '存入礦機'],
  Redeemed: ['赎回矿机', 'Miner redeemed', '贖回礦機'], RewardsPaid: ['领取分红', 'Rewards claimed', '領取分紅'],
  LiquidityAdded: ['添加流动性', 'Liquidity added', '加入流動性'], LiquidityRemoved: ['移除流动性', 'Liquidity removed', '移除流動性'],
  MiningProjectCreated: ['创建矿机项目', 'Mining project created', '建立礦機項目'], TokenCreated: ['发行项目代币', 'Project token launched', '發行項目代幣'],
  GraduatedV2: ['项目毕业', 'Project graduated', '項目畢業'], MinerPurchased: ['采购矿机', 'Miner purchased', '採購礦機'],
  Contributed: ['矿场入资', 'Farm contribution', '礦場入資'], FarmRewardsPaid: ['矿场分红', 'Farm rewards paid', '礦場分紅'],
  TaxConverted: ['税款转换', 'Tax converted', '稅款轉換'], FarmFunded: ['税款入矿场', 'Farm funded', '稅款入礦場'],
  BurnCreditCreated: ['烧币加权', 'Burn weight added', '燒幣加權'], BurnCreditExpired: ['烧币加权到期', 'Burn weight expired', '燒幣加權到期'],
  Transfer: ['资产转移', 'Asset transferred', '資產轉移'], Mint: ['添加流动性', 'Liquidity added', '加入流動性'],
  Burn: ['移除流动性', 'Liquidity removed', '移除流動性'], Sync: ['池状态更新', 'Pool state updated', '池狀態更新'],
}
export function indexEventName(name: string, locale: Locale): string {
  return eventNames[name]?.[locale === 'en' ? 1 : locale === 'yue-HK' ? 2 : 0] ?? name
}
