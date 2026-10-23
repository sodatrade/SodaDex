import { useState, type ReactElement } from 'react'
import { ASSETS, type AssetId } from '../domain/assets'
import { usePreferences } from '../preferences/context'
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
  const { t } = usePreferences()
  const query = search.trim().toLowerCase()
  const assets = ASSETS.filter((asset) =>
    `${asset.symbol} ${asset.name} ${asset.address ?? ''}`.toLowerCase().includes(query),
  )

  return (
    <Dialog title={t('chooseAsset')} description={t('verifiedAssets')} onClose={onClose}>
      <label className="search-field">
        <Icon name="search" />
        <input
          autoFocus
          data-dialog-autofocus
          aria-label={t('assetSearchLabel')}
          placeholder={t('assetSearchPlaceholder')}
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
            <AssetIcon assetId={asset.id} />
            <span className="asset-option-label">
              <strong>{asset.symbol}</strong>
              <span>
                {t(asset.id === 'okb' ? 'nativeAsset' : asset.id === 'usdt0' ? 'stableAsset' : 'wrappedAsset')}
              </span>
            </span>
            {asset.id === selected && <Icon name="check" />}
          </button>
        ))}
        {assets.length === 0 && <p className="empty-search">{t('noAssets')}</p>}
      </div>
      <p className="dialog-note">{t('assetExplanation')}</p>
    </Dialog>
  )
}
