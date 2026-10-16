import type { ReactElement } from 'react'
import { formatBalance } from '../domain/amount'
import { ASSETS, EXPLORER_URL, shortenAddress, type AssetId } from '../domain/assets'
import { AssetIcon, Icon, Surface } from './primitives'

export function AssetPage({
  balances,
  connected,
  loading,
  error,
}: {
  balances: Record<AssetId, bigint> | undefined
  connected: boolean
  loading: boolean
  error: boolean
}): ReactElement {
  return (
    <section className="content-page" aria-labelledby="assets-title">
      <div className="page-heading">
        <span className="eyebrow">YOUR ASSETS / X LAYER</span>
        <h1 id="assets-title">认识你的链上资产。</h1>
        <p>从原生 OKB 开始，保持每一步清晰。</p>
      </div>
      <Surface className="assets-surface">
        <div className="asset-table-head">
          <span>资产</span>
          <span>钱包余额</span>
        </div>
        {ASSETS.map((asset) => (
          <div className="asset-table-row" key={asset.id}>
            <AssetIcon wrapped={asset.id === 'wokb'} />
            <div className="asset-table-name">
              <strong>{asset.symbol}</strong>
              <span>{asset.name}</span>
              {asset.address ? (
                <a href={`${EXPLORER_URL}/token/${asset.address}`} target="_blank" rel="noreferrer">
                  {shortenAddress(asset.address)}
                  <Icon name="external" size={12} />
                </a>
              ) : (
                <span className="native-label">X Layer 原生资产</span>
              )}
            </div>
            <div className="asset-balance">
              <strong>
                {loading ? '读取中…' : error ? '暂不可用' : balances ? formatBalance(balances[asset.id]) : '—'}
              </strong>
              <span>{connected ? asset.symbol : '连接钱包查看'}</span>
            </div>
          </div>
        ))}
      </Surface>
      <p className="asset-page-note">
        <Icon name="layers" size={17} />
        V3 使用 WOKB 参与 ERC-20 交易；V4 可支持原生 OKB。当前不执行包装或兑换。
      </p>
    </section>
  )
}
