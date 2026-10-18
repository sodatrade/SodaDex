import type { WalletOption } from './wallet'
const KEY = 'sodadex.wallet-consent.v1'
export function walletConsentId(option: WalletOption): string { return option.rdns ?? option.id }
export function rememberedWallet(): string | undefined {
  try { return sessionStorage.getItem(KEY) ?? undefined } catch { return undefined }
}
export function rememberWallet(option?: WalletOption): void {
  try {
    if (option) sessionStorage.setItem(KEY, walletConsentId(option))
    else sessionStorage.removeItem(KEY)
  } catch { /* Connection works without persistence when storage is unavailable. */ }
}
