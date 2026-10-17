import type { Locale } from '../preferences/model'

const messages = {
  'zh-CN': {
    title: '矿机业务测试网', note: 'X Layer 1952 · 仅使用测试资产',
    pending: '矿机业务尚未部署就绪',
    detail: '募资分红与矿机碎片化将在此接入。1952 的合约和测试资产核验完成前，兑换、流动性、限价单及行情均未开放。',
    network: '测试网络', contract: '合约状态', balance: '测试 OKB 余额', wallet: '连接钱包查看测试余额',
    isolated: '此测试网独立于 196 测试站，不读取其代币、合约、行情或订单。',
    baseTitle: 'FAB 矿机基础合约已部署', baseDetail: '以下数据来自 1952 底层矿机合约，业务可用状态以上方的合约核验结果为准。',
    registeredMiners: '登记矿机数', verifiedMiners: '验证矿机数', totalMined: '累计挖矿产出', fabBalance: '我的测试 FAB', nftBalance: '我的矿机 NFT',
    baseUnavailable: '暂时读不到矿机合约数据，请重试。', reload: '重新读取', actualOutput: '累计产出是底层矿机实际铸出的总量，不是你的可领取分红。',
    baseAddresses: '查看已核验的基础合约', fab: '测试 FAB', mining: '挖矿', circuits: '矿机 NFT', circuitMarket: '矿机市场', lens: '批量查询',
  },
  en: {
    title: 'Mining testnet', note: 'X Layer 1952 · Test assets only',
    pending: 'Mining contracts are not ready',
    detail: 'Fundraising dividends and miner fragmentation will be connected here. Swaps, liquidity, limit orders and market data remain unavailable until the 1952 contracts and test assets are verified.',
    network: 'Test network', contract: 'Contract status', balance: 'Test OKB balance', wallet: 'Connect a wallet to view your test balance',
    isolated: 'This testnet is separate from the 196 test site and does not read its tokens, contracts, market data or orders.',
    baseTitle: 'FAB mining base contracts deployed', baseDetail: 'These values come from the underlying 1952 mining contracts. Product availability follows the contract verification status above.',
    registeredMiners: 'Registered miners', verifiedMiners: 'Verified miners', totalMined: 'Total mining output', fabBalance: 'My test FAB', nftBalance: 'My miner NFTs',
    baseUnavailable: 'Mining contract data is unavailable. Please retry.', reload: 'Reload', actualOutput: 'Total output is FAB actually minted by the mining protocol, not your claimable dividends.',
    baseAddresses: 'View verified base contracts', fab: 'Test FAB', mining: 'Mining', circuits: 'Miner NFT', circuitMarket: 'Miner market', lens: 'Read lens',
  },
  'yue-HK': {
    title: '礦機業務測試網', note: 'X Layer 1952 · 只用測試資產',
    pending: '礦機業務合約未部署好',
    detail: '募資分紅同礦機碎片化會喺呢度接入。1952 嘅合約同測試資產核實好之前，兌換、流動性、限價單同行情都未開放。',
    network: '測試網絡', contract: '合約狀態', balance: '測試 OKB 餘額', wallet: '連接銀包睇測試餘額',
    isolated: '呢個測試網獨立於 196 測試站，唔會讀取佢嘅代幣、合約、行情或者訂單。',
    baseTitle: 'FAB 礦機基礎合約已部署', baseDetail: '以下數據來自 1952 底層礦機合約，業務可用狀態以上面嘅合約核實結果為準。',
    registeredMiners: '已登記礦機數', verifiedMiners: '已驗證礦機數', totalMined: '累計挖礦產出', fabBalance: '我嘅測試 FAB', nftBalance: '我嘅礦機 NFT',
    baseUnavailable: '暫時讀唔到礦機合約數據，請再試。', reload: '重新讀取', actualOutput: '累計產出係底層礦機實際鑄出嘅總量，唔係你可以領取嘅分紅。',
    baseAddresses: '查看已核實嘅基礎合約', fab: '測試 FAB', mining: '挖礦', circuits: '礦機 NFT', circuitMarket: '礦機市場', lens: '批量查詢',
  },
} as const

export function miningNetworkMessages(locale: Locale): typeof messages[Locale] { return messages[locale] }
