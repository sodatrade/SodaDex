import { useEffect, type ReactElement } from 'react'
import { formatBalance } from '../domain/amount'
import { ASSETS, EXPLORER_URL, shortenAddress, type AssetId } from '../domain/assets'
import { usePreferences } from '../preferences/context'
import { CURRENCY_SYMBOLS } from '../preferences/model'
import { AssetIcon, Icon, Surface } from './primitives'

export interface AssetSelection {
  id: AssetId
}

export function AssetPage({
  balances,
  connected,
  loading,
  error,
  selected,
}: {
  balances: Record<AssetId, bigint> | undefined
  connected: boolean
  loading: boolean
  error: boolean
  selected?: AssetSelection
}): ReactElement {
  const { t, currency } = usePreferences()
  useEffect(() => {
    if (selected) {
      document.getElementById(`asset-${selected.id}`)?.focus()
    }
  }, [selected])
  return (
    <section className="content-page" aria-labelledby="assets-title">
      <div className="page-heading">
        <span className="eyebrow">{t('assetsEyebrow')}</span>
        <h1 id="assets-title">{t('assetsTitle')}</h1>
        <p>{t('assetsDescription')}</p>
      </div>
      <Surface className="assets-surface">
        <div className="asset-table-head">
          <span>{t('navAssets')}</span>
          <span>{t('priceIn', { currency })}</span>
          <span>{t('walletBalance')}</span>
        </div>
        {ASSETS.map((asset) => (
          <div
            role="group"
            className={`asset-table-row${asset.id === selected?.id ? ' is-selected' : ''}`}
            key={asset.id}
            id={`asset-${asset.id}`}
            tabIndex={asset.id === selected?.id ? -1 : undefined}
            aria-label={asset.id === selected?.id ? t('selectedAsset', { symbol: asset.symbol }) : asset.symbol}
          >
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
                <span className="native-label">{t('nativeAsset')}</span>
              )}
            </div>
            <span
              className="asset-price"
              title={t('pricePending')}
              aria-label={`${t('priceIn', { currency })} · ${t('pricePending')}`}
            >
              {CURRENCY_SYMBOLS[currency]} —
            </span>
            <div className="asset-balance">
              <strong>
                {loading ? t('reading') : error ? t('unavailable') : balances ? formatBalance(balances[asset.id]) : '—'}
              </strong>
              <span>{connected ? asset.symbol : t('connectToView')}</span>
            </div>
          </div>
        ))}
      </Surface>
      <p className="asset-page-note">
        <Icon name="layers" size={17} />
        {t('assetPageNote')}
      </p>
      <p className="asset-page-note">
        {t('pricePending')} · {t('currencyNote')}
      </p>
    </section>
  )
}
