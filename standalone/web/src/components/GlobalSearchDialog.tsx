import { useRef, useState, type ReactElement } from 'react'
import { ASSETS, EXPLORER_URL, shortenAddress, type AssetId } from '../domain/assets'
import { isAddress } from '../lib/rpc'
import { usePreferences } from '../preferences/context'
import { POOLS } from '../trading/config'
import { Dialog } from './Dialog'
import { POOL_SEARCH_TEXT } from './PoolRecords'
import { AssetIcon, Button, Icon } from './primitives'

type Category = 'all' | 'tokens' | 'pools' | 'wallets'

export function GlobalSearchDialog({
  onClose,
  onAsset,
  onPool,
}: {
  onClose: () => void
  onAsset: (id: AssetId) => void
  onPool: () => void
}): ReactElement {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<Category>('all')
  const input = useRef<HTMLInputElement>(null)
  const { t } = usePreferences()
  const query = search.trim().toLowerCase()
  const matches = ASSETS.filter((asset) =>
    `${asset.symbol} ${asset.name} ${asset.address ?? ''}`.toLowerCase().includes(query),
  )
  const address = isAddress(search.trim()) ? search.trim() : undefined
  const showTokens = category === 'all' || category === 'tokens'
  const showAddress = (category === 'all' || category === 'wallets') && !!address
  const showPools = POOLS.ready && (category === 'all' || category === 'pools') && POOL_SEARCH_TEXT.includes(query)
  const empty = !showPools && !showAddress && !(showTokens && matches.length > 0)
  const categories: { id: Category; label: string }[] = [
    { id: 'all', label: t('searchAll') },
    { id: 'tokens', label: t('searchTokens') },
    { id: 'pools', label: t('searchPools') },
    { id: 'wallets', label: t('searchWallets') },
  ]

  const clear = (): void => {
    setSearch('')
    input.current?.focus()
  }
  const escape = (): boolean => {
    if (search) {
      clear()
      return true
    }
    return false
  }

  return (
    <Dialog title={t('globalSearch')} description={t('globalSearchDescription')} onClose={onClose} onEscape={escape}>
      <label className="search-field global-search-field">
        <Icon name="search" />
        <input
          ref={input}
          data-dialog-autofocus
          aria-label={t('globalSearchLabel')}
          placeholder={t('globalSearchPlaceholder')}
          value={search}
          maxLength={100}
          onChange={(event) => setSearch(event.target.value)}
        />
        {search && (
          <Button appearance="icon" className="search-clear" aria-label={t('clearSearch')} onClick={clear}>
            <Icon name="close" size={16} />
          </Button>
        )}
      </label>
      <div className="search-categories" role="group" aria-label={t('searchCategories')}>
        {categories.map((item) => (
          <button key={item.id} aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="global-search-results" aria-live="polite">
        {showTokens && matches.length > 0 && (
          <section aria-label={t('knownAssets')}>
            <h3 className="search-section-heading">{t('knownAssets')}</h3>
            {matches.map((asset) => (
              <button className="asset-option" key={asset.id} onClick={() => onAsset(asset.id)}>
                <AssetIcon assetId={asset.id} />
                <span className="asset-option-label">
                  <strong>{asset.symbol}</strong>
                  <span>
                    {t(asset.id === 'okb' ? 'nativeAsset' : asset.id === 'usdt0' ? 'stableAsset' : 'wrappedAsset')}
                  </span>
                </span>
                <Icon name="chevron" size={16} />
              </button>
            ))}
          </section>
        )}
        {showPools && (
          <section aria-label={t('searchPools')}>
            <h3 className="search-section-heading">{t('searchPools')}</h3>
            <button className="asset-option" onClick={onPool}>
              <Icon name="layers" />
              <span className="asset-option-label">
                <strong>OKB / USD₮0 · V3 + V4</strong>
                <span>{t('poolsReady')}</span>
              </span>
              <Icon name="chevron" size={16} />
            </button>
          </section>
        )}
        {showAddress && address && (
          <section aria-label={t('publicAddress')}>
            <h3 className="search-section-heading">{t('publicAddress')}</h3>
            <a
              className="address-search-result"
              href={`${EXPLORER_URL}/address/${address}`}
              target="_blank"
              rel="noreferrer"
              aria-label={t('addressResult', { address })}
            >
              <Icon name="wallet" />
              <span>
                <strong>{shortenAddress(address)}</strong>
                <span>{address}</span>
              </span>
              <Icon name="external" size={16} />
            </a>
            <p className="dialog-note">{t('searchAddressNote')}</p>
          </section>
        )}
        {empty && (
          <div className="empty-search">
            <p>
              {category === 'pools'
                ? t(POOLS.ready ? 'searchNoResults' : 'searchNoPools')
                : category === 'wallets'
                  ? t('searchWalletHint')
                  : t('searchNoResults')}
            </p>
            {category !== 'pools' && category !== 'wallets' && <span>{t('searchNoResultsHint')}</span>}
          </div>
        )}
      </div>
    </Dialog>
  )
}
