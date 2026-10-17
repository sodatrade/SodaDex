import type { Locale } from '../preferences/model'

const messages = {
  'zh-CN': {
    title: '矿机业务测试网', note: 'X Layer 1952 · 仅使用测试资产',
    pending: '矿机业务尚未部署就绪',
    detail: '募资分红与矿机碎片化将在此接入。1952 的合约和测试资产核验完成前，兑换、流动性、限价单及行情均未开放。',
    network: '测试网络', contract: '合约状态', balance: '测试 OKB 余额', wallet: '连接钱包查看测试余额',
    isolated: '此测试网独立于 196 测试站，不读取其代币、合约、行情或订单。',
  },
  en: {
    title: 'Mining testnet', note: 'X Layer 1952 · Test assets only',
    pending: 'Mining contracts are not ready',
    detail: 'Fundraising dividends and miner fragmentation will be connected here. Swaps, liquidity, limit orders and market data remain unavailable until the 1952 contracts and test assets are verified.',
    network: 'Test network', contract: 'Contract status', balance: 'Test OKB balance', wallet: 'Connect a wallet to view your test balance',
    isolated: 'This testnet is separate from the 196 test site and does not read its tokens, contracts, market data or orders.',
  },
  'yue-HK': {
    title: '礦機業務測試網', note: 'X Layer 1952 · 只用測試資產',
    pending: '礦機業務合約未部署好',
    detail: '募資分紅同礦機碎片化會喺呢度接入。1952 嘅合約同測試資產核實好之前，兌換、流動性、限價單同行情都未開放。',
    network: '測試網絡', contract: '合約狀態', balance: '測試 OKB 餘額', wallet: '連接銀包睇測試餘額',
    isolated: '呢個測試網獨立於 196 測試站，唔會讀取佢嘅代幣、合約、行情或者訂單。',
  },
} as const

export function miningNetworkMessages(locale: Locale): typeof messages[Locale] { return messages[locale] }
