import { toast } from 'svelte-sonner'
import { CHAIN_ID, shortenAddress } from '../domain/assets'
import type { Translate } from '../i18n/types'
import type { WalletSession } from './wallet'

const WALLET_TOAST = 'wallet'

/**
 * Announces one session transition, whether it came from this page or from the wallet itself.
 * Returns true when the session just became ready on X Layer.
 */
export function announceWalletChange(
  before: WalletSession | undefined,
  session: WalletSession | undefined,
  t: Translate,
): boolean {
  if (before === session) return false
  if (!session) {
    if (before) toast(t('toastWalletDisconnected'), { id: WALLET_TOAST })
    return false
  }
  const onChain = session.chainId === CHAIN_ID
  const description = onChain ? shortenAddress(session.address) : t('walletNetwork', { chainId: session.chainId })
  if (!before) {
    if (onChain) toast.success(t('toastWalletConnected'), { id: WALLET_TOAST, description })
    else toast.warning(t('toastWrongNetwork'), { id: WALLET_TOAST, description })
  } else if (before.address.toLowerCase() !== session.address.toLowerCase()) {
    toast(t('toastAccountChanged'), { id: WALLET_TOAST, description: shortenAddress(session.address) })
  } else if (before.chainId !== session.chainId) {
    if (onChain) toast.success(t('toastNetworkReady'), { id: WALLET_TOAST, description })
    else toast.warning(t('toastWrongNetwork'), { id: WALLET_TOAST, description })
  } else return false
  return onChain && (!before || before.chainId !== CHAIN_ID)
}
