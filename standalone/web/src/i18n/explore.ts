import type { Locale } from '../preferences/model'
const zh = {
  title: '探索 X Layer', note: '查看代币、SodaDEX 资金池和官方 Uniswap 的只读候选池。', tokens: '代币', pools: '资金池', transactions: '交易记录', reference: '官方池 · 只读',
  search: '搜索名称、符号或地址', token: '代币', source: '来源', contract: '合约地址', builtin: '内置资产', officialList: 'X Layer 官方列表', imported: '本地导入',
  loading: '正在读取数据…', error: '数据暂不可用，请重试。', retry: '重试', partial: '部分列表或元数据未能读取，已显示成功读取的资产。', empty: '没有匹配的结果。',
  details: '代币详情', back: '返回代币列表', decimals: '精度', network: '网络', native: '原生 OKB', balance: '钱包余额', connect: '连接钱包查看余额', wrongChain: '切换到 X Layer 查看余额',
  noFiat: '按原币显示；未接入独立法币估值或全链 24 小时排名。', ownPools: 'SodaDEX 资金池', noOwnPools: '已读取的 SodaDEX 池中没有此资产。', quote: '查看只读报价',
  referenceNote: '固定来源：官方 Uniswap。仅查询指定币对的候选，不能在此授权或提交交易。', candidate: '候选查询不代表全链池子或排名。',
  token0: '资产 A 地址', token1: '资产 B 地址', find: '查询候选池', invalidPair: '请输入两个不同的有效地址。原生 OKB 使用零地址。',
  noReference: '此币对在所查候选范围内没有可用池。', candidateError: '部分候选读取失败，结果并不完整。', fee: '费率', protocol: '协议', poolId: '池地址 / ID',
  readOnly: '只读 · 不会请求钱包授权或交易', pay: '查询数量', receive: '预计收到', reverse: '切换方向', invalidAmount: '请输入符合资产精度的正数。', metadataMissing: '资产元数据不完整，无法显示精确报价。',
  ownNote: '以下行情和交易来自 SodaDEX 合约。', officialAction: '查看官方池只读数据', metadataNote: '详情元数据与余额重新从 X Layer 读取。',
} as const
export type ExploreMessages = Record<keyof typeof zh, string>
const en: ExploreMessages = {
  title: 'Explore X Layer', note: 'Browse tokens, SodaDEX pools and read-only official Uniswap pool candidates.', tokens: 'Tokens', pools: 'Pools', transactions: 'Transactions', reference: 'Official pools · Read only',
  search: 'Search name, symbol or address', token: 'Token', source: 'Source', contract: 'Contract address', builtin: 'Built-in asset', officialList: 'Official X Layer list', imported: 'Locally imported',
  loading: 'Reading data…', error: 'Data unavailable. Please retry.', retry: 'Retry', partial: 'Some list or metadata reads failed. Successfully read assets are shown.', empty: 'No matching results.',
  details: 'Token details', back: 'Back to tokens', decimals: 'Decimals', network: 'Network', native: 'Native OKB', balance: 'Wallet balance', connect: 'Connect wallet for balance', wrongChain: 'Switch to X Layer for balance',
  noFiat: 'Token units only. Independent fiat values and chain-wide 24-hour rankings are unavailable.', ownPools: 'SodaDEX pools', noOwnPools: 'No matching asset was found in the SodaDEX pools read.', quote: 'View read-only quote',
  referenceNote: 'Fixed source: official Uniswap. Pair candidates only; no approvals or transactions can be submitted here.', candidate: 'Candidate discovery is not a chain-wide pool index or ranking.',
  token0: 'Asset A address', token1: 'Asset B address', find: 'Find pool candidates', invalidPair: 'Enter two different valid addresses. Native OKB uses the zero address.',
  noReference: 'No available pool was found within the queried candidates.', candidateError: 'Some candidate reads failed; results are incomplete.', fee: 'Fee', protocol: 'Protocol', poolId: 'Pool address / ID',
  readOnly: 'Read only · No wallet approval or transaction', pay: 'Quote amount', receive: 'Estimated receive', reverse: 'Reverse direction', invalidAmount: 'Enter a positive amount within the asset precision.', metadataMissing: 'Incomplete token metadata prevents an exact quote.',
  ownNote: 'The following market data and activity come from SodaDEX contracts.', officialAction: 'View official pools read only', metadataNote: 'Details and balances are read again from X Layer.',
}
const yue: ExploreMessages = {
  title: '探索 X Layer', note: '睇代幣、SodaDEX 資金池同官方 Uniswap 嘅唯讀候選池。', tokens: '代幣', pools: '資金池', transactions: '交易紀錄', reference: '官方池 · 唯讀',
  search: '搜尋名稱、符號或地址', token: '代幣', source: '來源', contract: '合約地址', builtin: '內置資產', officialList: 'X Layer 官方列表', imported: '本地匯入',
  loading: '讀取數據中…', error: '數據暫時用唔到，請再試。', retry: '再試', partial: '部分列表或元數據讀取失敗，已顯示讀到嘅資產。', empty: '冇符合嘅結果。',
  details: '代幣詳情', back: '返回代幣列表', decimals: '精度', network: '網絡', native: '原生 OKB', balance: '錢包餘額', connect: '連接錢包睇餘額', wrongChain: '切換至 X Layer 睇餘額',
  noFiat: '用原幣顯示；未接入獨立法幣估值或全鏈 24 小時排名。', ownPools: 'SodaDEX 資金池', noOwnPools: '讀取到嘅 SodaDEX 池冇呢個資產。', quote: '睇唯讀報價',
  referenceNote: '固定來源：官方 Uniswap。只查指定幣對候選，唔可以喺度授權或提交交易。', candidate: '候選查詢唔代表全鏈池子或排名。',
  token0: '資產 A 地址', token1: '資產 B 地址', find: '查詢候選池', invalidPair: '請輸入兩個唔同嘅有效地址。原生 OKB 用零地址。',
  noReference: '呢個幣對喺查詢候選範圍內冇可用池。', candidateError: '部分候選讀取失敗，結果唔完整。', fee: '費率', protocol: '協議', poolId: '池地址 / ID',
  readOnly: '唯讀 · 唔會要求錢包授權或交易', pay: '查詢數量', receive: '預計收到', reverse: '切換方向', invalidAmount: '請輸入符合資產精度嘅正數。', metadataMissing: '資產元數據唔完整，無法顯示精確報價。',
  ownNote: '以下行情同交易來自 SodaDEX 合約。', officialAction: '睇官方池唯讀數據', metadataNote: '詳情元數據同餘額會重新由 X Layer 讀取。',
}
export const exploreMessages = (locale: Locale): ExploreMessages => locale === 'en' ? en : locale === 'yue-HK' ? yue : zh
