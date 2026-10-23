import { useRef, useState, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { zeroAddress, type Address } from 'viem'
import { ASSETS, EXPLORER_URL, shortenAddress, type AssetId } from '../domain/assets'
import { isAddress } from '../lib/rpc'
import { usePreferences } from '../preferences/context'
import { POOLS } from '../trading/config'
import { builtinTokens, useExploreCatalog } from '../features/explore/catalog'
import { getPools } from '../features/market/api'
import { TokenIcon } from './TokenIcon'
import { exploreMessages } from '../i18n/explore'
import { Dialog } from './Dialog'
import { POOL_SEARCH_TEXT } from './PoolRecords'
import { Button, Icon } from './primitives'
import { Pagination, usePagination } from './Pagination'

type Category = 'all' | 'tokens' | 'pools' | 'wallets'

export function GlobalSearchDialog({
  onClose,
  onAsset,
  onPool,
  onToken,
  onReference,
}: {
  onClose: () => void
  onAsset: (id: AssetId) => void
  onPool: () => void
  onToken?: (address: Address) => void
  onReference?: () => void
}): ReactElement {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<Category>('all')
  const input = useRef<HTMLInputElement>(null)
  const { t, locale } = usePreferences(), m = exploreMessages(locale)
  const catalog = useExploreCatalog()
  const pools = useQuery({ queryKey: ['dex-pools'], queryFn: getPools, retry: false, enabled: POOLS.ready, staleTime: 30_000 })
  const query = search.trim().toLowerCase()
  const tokens = catalog.data?.tokens ?? builtinTokens
  const matches = tokens.filter(({ currency }) => `${currency.symbol} ${currency.name} ${currency.address}`.toLowerCase().includes(query))
  const symbol = (address: string): string => tokens.find(v => v.currency.address.toLowerCase() === address.toLowerCase())?.currency.symbol ?? shortenAddress(address)
  const address = isAddress(search.trim()) ? search.trim() : undefined
  const showTokens = category === 'all' || category === 'tokens'
  const showAddress = (category === 'all' || category === 'wallets') && !!address
  const showTokenAddress = !!onToken && showTokens && !!address && !matches.length
  const poolCategory = category === 'all' || category === 'pools'
  const poolMatches = pools.data?.pools.filter(p => `${p.id} ${p.token0} ${p.token1} ${symbol(p.token0)} ${symbol(p.token1)} ${p.protocol} SodaDEX`.toLowerCase().includes(query)) ?? []
  const showSeed = POOLS.ready && !pools.data && POOL_SEARCH_TEXT.includes(query)
  const showPools = poolCategory && (showSeed || poolMatches.length > 0)
  const showReference = !!onReference && poolCategory && (!query || `uniswap official 官方 官方池 只读 唯讀`.includes(query))
  const empty = !showPools && !showReference && !showAddress && !showTokenAddress && !(showTokens && matches.length > 0)
  const pagination = usePagination([
    ...(showTokens ? matches.map(({ currency }) => `token:${currency.address}`) : []),
    ...(showPools ? [...(showSeed ? ['seed'] : []), ...poolMatches.map((pool) => `pool:${pool.protocol}:${pool.id}`)] : []),
    ...(showReference ? ['reference'] : []), ...(showTokenAddress ? ['token-address'] : []), ...(showAddress ? ['address'] : []),
  ], `${category}:${query}`)
  const pageKeys = new Set(pagination.items)
  const pageTokens = matches.filter(({ currency }) => pageKeys.has(`token:${currency.address}`))
  const pagePools = poolMatches.filter((pool) => pageKeys.has(`pool:${pool.protocol}:${pool.id}`))
  const select = (address: Address): void => {
    const asset = ASSETS.find(a => (a.address ?? zeroAddress).toLowerCase() === address.toLowerCase())
    if (onToken) onToken(address)
    else if (asset) onAsset(asset.id)
  }
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
    <Dialog className="global-search-dialog" title={t('globalSearch')} description={t('globalSearchDescription')} onClose={onClose} onEscape={escape}>
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
        {pageTokens.length > 0 && (
          <section aria-label={t('knownAssets')}>
            <h3 className="search-section-heading">{t('knownAssets')}</h3>
            {pageTokens.map(({ currency, source }) => (
              <button className="asset-option" key={currency.address} onClick={() => select(currency.address)} disabled={!onToken && !ASSETS.some(a => (a.address ?? zeroAddress).toLowerCase() === currency.address.toLowerCase())}>
                <TokenIcon address={currency.address} symbol={currency.symbol} native={currency.native} small />
                <span className="asset-option-label">
                  <strong>{currency.symbol}</strong>
                  <span>
                    {currency.name} · {m[source]}
                  </span>
                </span>
                <Icon name="chevron" size={16} />
              </button>
            ))}
          </section>
        )}
        {(pageKeys.has('seed') || pagePools.length > 0) && (
          <section aria-label={t('searchPools')}>
            <h3 className="search-section-heading">{t('searchPools')}</h3>
            {pageKeys.has('seed') && <button className="asset-option" onClick={onPool}>
              <Icon name="layers" />
              <span className="asset-option-label">
                <strong>OKB / USD₮0 · V3 + V4</strong>
                <span>{t('poolsReady')}</span>
              </span>
              <Icon name="chevron" size={16} />
            </button>}
            {pagePools.map(pool => <button className="asset-option" key={`${pool.protocol}:${pool.id}`} onClick={onPool}>
              <Icon name="layers" /><span className="asset-option-label"><strong>{symbol(pool.token0)} / {symbol(pool.token1)}</strong>
                <span>SodaDEX · {pool.protocol.toUpperCase()} · {pool.fee / 10000}% · {shortenAddress(pool.id)}</span></span><Icon name="chevron" size={16} />
            </button>)}
          </section>
        )}
        {pageKeys.has('reference') && <button className="asset-option" onClick={onReference}><Icon name="layers" /><span className="asset-option-label"><strong>{m.officialAction}</strong><span>Uniswap · {m.readOnly}</span></span><Icon name="chevron" size={16} /></button>}
        {pageKeys.has('token-address') && address && <button className="asset-option" onClick={() => onToken?.(address as Address)}><Icon name="search" /><span className="asset-option-label"><strong>{m.details}</strong><span>{address}</span></span></button>}
        {poolCategory && pools.isError && <p role="alert">{m.error} <Button appearance="ghost" onClick={() => void pools.refetch()}>{m.retry}</Button></p>}
        {showTokens && catalog.data?.partial && <p role="alert">{m.partial} <Button appearance="ghost" onClick={() => void catalog.refetch()}>{m.retry}</Button></p>}
        {pageKeys.has('address') && address && (
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
        <Pagination {...pagination} />
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
