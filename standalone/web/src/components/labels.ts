import type { AssetId } from '../domain/assets'
import type { PlainMessageKey } from '../i18n/types'

export const assetHint = (id: AssetId): PlainMessageKey =>
  id === 'okb' ? 'nativeAsset' : id === 'usdt0' ? 'stableAsset' : 'wrappedAsset'
