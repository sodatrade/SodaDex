import { useState, type ReactElement } from 'react'
import { ASSETS, type AssetId } from '../domain/assets'
import { Dialog } from './Dialog'
import { AssetIcon, Icon } from './primitives'

export function AssetDialog({
  selected,
  onSelect,
  onClose,
}: {
  selected: AssetId
  onSelect: (id: AssetId) => void
  onClose: () => void
}): ReactElement {
  const [search, setSearch] = useState('')
  const query = search.trim().toLowerCase()
  const assets = ASSETS.filter((asset) =>
    `${asset.symbol} ${asset.name} ${asset.address ?? ''}`.toLowerCase().includes(query),
  )

  return (
    <Dialog title="选择资产" description="X Layer · 已核对的 OKB 资产" onClose={onClose}>
      <label className="search-field">
        <Icon name="search" />
        <input
          autoFocus
          data-dialog-autofocus
          aria-label="搜索资产名称或合约地址"
          placeholder="搜索名称或合约地址"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <div className="asset-options">
        {assets.map((asset) => (
          <button
            className="asset-option"
            key={asset.id}
            onClick={() => onSelect(asset.id)}
            aria-pressed={asset.id === selected}
          >
            <AssetIcon wrapped={asset.id === 'wokb'} />
            <span className="asset-option-label">
              <strong>{asset.symbol}</strong>
              <span>{asset.description}</span>
            </span>
            {asset.id === selected && <Icon name="check" />}
          </button>
        ))}
        {assets.length === 0 && <p className="empty-search">没有匹配的资产。当前仅提供 OKB 与 WOKB。</p>}
      </div>
      <p className="dialog-note">OKB 是原生资产；WOKB 用于兼容 ERC-20 的合约。</p>
    </Dialog>
  )
}
