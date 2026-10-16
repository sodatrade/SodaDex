import type { Locale } from '../preferences/model'
const zh = {
  trade: '交易', explore: '探索', portfolio: '投资组合', overview: '概览', tokens: '代币', pools: '资金池', nfts: '仓位 NFT', activity: '活动',
  portfolioTitle: '你的资产与仓位', portfolioNote: '连接 X Layer 钱包，查看实际余额、SodaDEX 仓位和活动。',
  exploreTitle: '探索 X Layer', exploreNote: '查看代币、自有测试池，以及外部官方池的只读数据。', transactions: '交易记录', reference: '官方池 · 只读',
  receive: '接收', send: '发送', swap: '兑换', liquidity: '流动性', refresh: '刷新', connect: '连接钱包', wrongChain: '切换到 X Layer',
  address: '钱包地址', network: '网络', copy: '复制地址', copied: '已复制', copyFailed: '请手动复制地址',
  receiveNote: '将此地址用于 X Layer（196）网络的收款。', balance: '余额', positions: 'SodaDEX 仓位', pending: '本设备待确认',
  noFiat: '未接入独立法币估值，余额按原币显示。', noPositions: '此钱包暂无 SodaDEX 仓位 NFT。', createPosition: '创建仓位', manage: '管理仓位',
  loading: '正在读取链上数据…', unavailable: '数据暂不可用', retry: '重试', imported: '已导入代币', token: '代币', name: '名称', contract: '合约',
  recipient: '收款地址', amount: '数量', preview: '预览发送', confirmSend: '确认并打开钱包', sendNote: '由当前钱包发送，确认前核对网络、资产、数量和收款地址。',
  invalidRecipient: '请输入有效且非零的收款地址', invalidAmount: '请输入余额范围内的有效数量', close: '关闭', viewTransaction: '查看交易',
  receipt: '刷新回执', sent: '发送已确认', sendAgain: '重新填写', query: '查询池子', readOnly: '只读展示，不会请求钱包交易',
  own: 'SodaDEX 测试池', pair: '交易对', price: '池内相对价格', fee: '费率', protocol: '协议', source: '来源',
  noPools: '此币对在所查询的候选范围中没有可用池。', referenceNote: '查询外部官方 Uniswap 的已配置币对候选；不代表全链排名。',
  bridge: 'X Layer 官方桥', bridgeNote: '在 OKX 官方桥页面操作，SodaDEX 不执行跨链交易。',
  tokenDetails: '代币详情', remove: '移除本地记录', localNote: '导入地址只保存在此浏览器；元数据和余额重新从链上读取。',
} as const
type Messages = Record<keyof typeof zh, string>
const en: Messages = {
  trade: 'Trade', explore: 'Explore', portfolio: 'Portfolio', overview: 'Overview', tokens: 'Tokens', pools: 'Pools', nfts: 'Position NFTs', activity: 'Activity',
  portfolioTitle: 'Your assets and positions', portfolioNote: 'Connect an X Layer wallet for live balances, SodaDEX positions and activity.',
  exploreTitle: 'Explore X Layer', exploreNote: 'Browse tokens, SodaDEX test pools and read-only external official pools.', transactions: 'Transactions', reference: 'Official pools · Read only',
  receive: 'Receive', send: 'Send', swap: 'Swap', liquidity: 'Liquidity', refresh: 'Refresh', connect: 'Connect wallet', wrongChain: 'Switch to X Layer',
  address: 'Wallet address', network: 'Network', copy: 'Copy address', copied: 'Copied', copyFailed: 'Copy the address manually', receiveNote: 'Use this address to receive on X Layer (196).',
  balance: 'Balance', positions: 'SodaDEX positions', pending: 'Pending on this device', noFiat: 'Independent fiat values are unavailable. Balances use native token units.',
  noPositions: 'This wallet has no SodaDEX position NFTs.', createPosition: 'Create position', manage: 'Manage position', loading: 'Reading onchain data…', unavailable: 'Data unavailable', retry: 'Retry',
  imported: 'Imported tokens', token: 'Token', name: 'Name', contract: 'Contract', recipient: 'Recipient address', amount: 'Amount', preview: 'Review send', confirmSend: 'Confirm in wallet',
  sendNote: 'Sent by the connected wallet. Review the network, asset, amount and recipient.', invalidRecipient: 'Enter a valid nonzero recipient address', invalidAmount: 'Enter a valid amount within your balance',
  close: 'Close', viewTransaction: 'View transaction', receipt: 'Refresh receipt', sent: 'Transfer confirmed', sendAgain: 'Start again', query: 'Find pools', readOnly: 'Read only; no wallet transaction is requested',
  own: 'SodaDEX test pools', pair: 'Pair', price: 'Relative pool price', fee: 'Fee', protocol: 'Protocol', source: 'Source', noPools: 'No available pool was found within the queried candidates.',
  referenceNote: 'Queries configured pair candidates on official Uniswap deployments. This is not a chain-wide ranking.', bridge: 'Official X Layer bridge', bridgeNote: 'Opens the official OKX bridge. SodaDEX does not execute a cross-chain transaction.',
  tokenDetails: 'Token details', remove: 'Remove local entry', localNote: 'Imported addresses stay in this browser; metadata and balances are read again onchain.',
}
const yue: Messages = {
  trade: '交易', explore: '探索', portfolio: '投資組合', overview: '概覽', tokens: '代幣', pools: '資金池', nfts: '倉位 NFT', activity: '活動',
  portfolioTitle: '你嘅資產同倉位', portfolioNote: '連接 X Layer 錢包，睇實際餘額、SodaDEX 倉位同活動。', exploreTitle: '探索 X Layer', exploreNote: '睇代幣、自有測試池，同外部官方池嘅唯讀數據。',
  transactions: '交易紀錄', reference: '官方池 · 唯讀', receive: '接收', send: '發送', swap: '兌換', liquidity: '流動性', refresh: '更新', connect: '連接錢包', wrongChain: '切換至 X Layer',
  address: '錢包地址', network: '網絡', copy: '複製地址', copied: '已複製', copyFailed: '請手動複製地址', receiveNote: '用呢個地址喺 X Layer（196）網絡收款。',
  balance: '餘額', positions: 'SodaDEX 倉位', pending: '本裝置待確認', noFiat: '未接入獨立法幣估值，餘額用原幣顯示。', noPositions: '呢個錢包未有 SodaDEX 倉位 NFT。',
  createPosition: '建立倉位', manage: '管理倉位', loading: '讀取鏈上數據中…', unavailable: '數據暫時用唔到', retry: '再試', imported: '已匯入代幣', token: '代幣', name: '名稱', contract: '合約',
  recipient: '收款地址', amount: '數量', preview: '預覽發送', confirmSend: '確認並開啟錢包', sendNote: '由目前錢包發送，確認前核對網絡、資產、數量同收款地址。',
  invalidRecipient: '請輸入有效而且唔係零嘅收款地址', invalidAmount: '請輸入餘額範圍內嘅有效數量', close: '關閉', viewTransaction: '查看交易', receipt: '更新回執', sent: '發送已確認', sendAgain: '重新填寫',
  query: '查詢池子', readOnly: '唯讀展示，唔會要求錢包交易', own: 'SodaDEX 測試池', pair: '交易對', price: '池內相對價格', fee: '費率', protocol: '協議', source: '來源',
  noPools: '呢個幣對喺查詢嘅候選範圍內冇可用池。', referenceNote: '查詢外部官方 Uniswap 已設定嘅幣對候選，唔代表全鏈排名。', bridge: 'X Layer 官方橋', bridgeNote: '喺 OKX 官方橋頁面操作，SodaDEX 唔會執行跨鏈交易。',
  tokenDetails: '代幣詳情', remove: '移除本地紀錄', localNote: '匯入地址只存喺呢個瀏覽器，元數據同餘額會重新由鏈上讀取。',
}
export function workspaceMessages(locale: Locale): Messages { return locale === 'en' ? en : locale === 'yue-HK' ? yue : zh }
