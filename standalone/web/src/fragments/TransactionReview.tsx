import { useState, useCallback, type ReactElement } from 'react'
import type { Hex } from 'viem'
import { formatEther } from 'viem'
import type { WalletController } from '../lib/useWallet'
import type { FragmentDeployment } from './config'
import { verifyDeployment, type FragmentClient, type PreparedTransaction } from './client'
import { TransientNotice } from './TransientNotice'
import { Dialog } from '../components/Dialog'
import { Button } from '../components/primitives'
import type { Messages } from './messages'
export function TransactionReview({ tx, client, deployment, wallet, m, onClose, onSuccess }: {
  tx: PreparedTransaction; client: FragmentClient; deployment: FragmentDeployment; wallet: WalletController; m: Messages
  onClose: () => void; onSuccess: (hash: Hex) => void
}): ReactElement {
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState({ message: '', id: 0 }), [hash, setHash] = useState<Hex>()
  const setError = useCallback((message: string): void => setNotice(previous => ({ message, id: previous.id + 1 })), [])
  const dismiss = useCallback((): void => setNotice(previous => ({ ...previous, message: '' })), [])
  async function checkReceipt(sent: Hex): Promise<void> {
    setBusy(true); setError('')
    try {
      const receipt = await client.waitForTransactionReceipt({ hash: sent })
      if (receipt.status !== 'success') throw new Error(m.actionError)
      onSuccess(sent)
    } catch (e) { setError(e instanceof Error ? e.message : m.actionError) }
    finally { setBusy(false) }
  }
  async function execute(): Promise<void> {
    setBusy(true); setError('')
    try {
      const identity = wallet.getIdentity()
      if (!identity || identity.chainId !== tx.chainId || identity.address.toLowerCase() !== tx.account.toLowerCase()) throw new Error(m.walletChanged)
      await verifyDeployment(client, deployment)
      await client.call({ account: tx.account, to: tx.to, data: tx.data, value: tx.value })
      // Fork evidence: newly accrued mining income can add a settlement path before inclusion.
      const estimate = await client.estimateGas({ account: tx.account, to: tx.to, data: tx.data, value: tx.value, blockTag: 'pending' })
      const gas = estimate * 2n
      if (wallet.getIdentity()?.revision !== identity.revision) throw new Error(m.walletChanged)
      const accounts = await identity.provider.request({ method: 'eth_accounts' })
      const chain = await identity.provider.request({ method: 'eth_chainId' })
      if (!Array.isArray(accounts) || String(accounts[0]).toLowerCase() !== tx.account.toLowerCase() || Number(chain) !== tx.chainId) throw new Error(m.walletChanged)
      const result = await identity.provider.request({ method: 'eth_sendTransaction', params: [{ from: tx.account, to: tx.to, data: tx.data, value: `0x${tx.value.toString(16)}`, gas: `0x${gas.toString(16)}`, chainId: `0x${tx.chainId.toString(16)}` }] })
      if (typeof result !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(result)) throw new Error(m.actionError)
      const sent = result as Hex; setHash(sent)
      await checkReceipt(sent)
    } catch (e) { setError(e instanceof Error ? e.message : m.actionError) }
    finally { setBusy(false) }
  }
  return <Dialog onEscape={() => busy} title={m.review} description={tx.label} onClose={() => { if (!busy) onClose() }}>
    <dl className="fragment-review"><dt>{m.contract}</dt><dd>{tx.to}</dd><dt>{m.native}</dt><dd>{formatEther(tx.value)} OKB</dd></dl>
    {hash && <p className="fragment-hash">{hash}</p>}
    {notice.message && <TransientNotice message={notice.message} id={notice.id} onDismiss={dismiss} />}
    <div className="fragment-actions"><Button onClick={onClose} disabled={busy}>{m.cancel}</Button>
      <Button appearance="primary" disabled={busy} onClick={() => { void (hash ? checkReceipt(hash) : execute()) }}>{busy ? m.pending : hash ? m.retry : m.confirm}</Button></div>
  </Dialog>
}
