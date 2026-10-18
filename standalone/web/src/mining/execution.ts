import { toHex, type Hex } from 'viem'
import { validMiningProductCall, type MiningTransaction } from '../../../mining-calls'
import type { MiningProductDeployment } from '../../../mining-products'
import { hexQuantity } from '../lib/readRpc'
import { firstAccount, type WalletIdentity } from '../lib/wallet'
import { receiptStatus } from '../trading/receipts'
import { type MiningSubmission } from './journal'
import { type MiningRpc, verifyMiningDeployment } from './protocol'

export type MiningStage = 'miningChecking' | 'miningSimulating' | 'miningWallet' | 'miningConfirming' | 'miningSuccess'
export interface MiningExecution {
  deployment: MiningProductDeployment; identity: WalletIdentity; getIdentity: () => WalletIdentity | undefined
  isCurrent: () => boolean; read: MiningRpc
  onStage: (stage: MiningStage) => void
  onSubmission: (record: MiningSubmission) => void
  wait?: (hash: Hex, tx: MiningTransaction) => Promise<'pending' | 'success' | 'reverted'>
}
/** This boundary never signs: the active wallet confirms each exact call. */
export async function executeMiningCall(c: MiningExecution, tx: MiningTransaction, action: string, approval = false): Promise<MiningSubmission> {
  const assertCurrent = (): void => {
    const now = c.getIdentity()
    if (!c.isCurrent() || !now || now.provider !== c.identity.provider || now.revision !== c.identity.revision ||
      now.chainId !== c.deployment.chainId || now.address.toLowerCase() !== c.identity.address.toLowerCase() ||
      tx.from.toLowerCase() !== now.address.toLowerCase()) throw new Error('miningIdentityChanged')
  }
  const checkWallet = async (): Promise<void> => {
    assertCurrent()
    const chain = await c.identity.provider.request({ method: 'eth_chainId' }); assertCurrent()
    const accounts = await c.identity.provider.request({ method: 'eth_accounts' }); assertCurrent()
    if (chain !== toHex(c.deployment.chainId) || firstAccount(accounts)?.toLowerCase() !== c.identity.address.toLowerCase()) throw new Error('miningIdentityChanged')
  }
  if (!validMiningProductCall(tx, c.deployment, true)) throw new Error('miningInvalidAction')
  assertCurrent(); c.onStage('miningChecking')
  await checkWallet(); await verifyMiningDeployment(c.read, c.deployment); assertCurrent()
  c.onStage('miningSimulating')
  const simulated = await c.read('eth_call', [tx, 'pending']); assertCurrent()
  if (typeof simulated !== 'string' || !/^0x(?:[a-fA-F0-9]{2})*$/.test(simulated) ||
      (approval && simulated !== '0x' && simulated !== toHex(1n, { size: 32 }))) throw new Error('miningSimulationFailed')
  const estimate = hexQuantity(await c.read('eth_estimateGas', [tx, 'pending'])); assertCurrent()
  const gas = (estimate * 120n + 99n) / 100n
  const price = hexQuantity(await c.read('eth_gasPrice')); assertCurrent()
  const balance = hexQuantity(await c.read('eth_getBalance', [tx.from, 'latest'])); assertCurrent()
  if (gas <= 0n || price <= 0n || balance < hexQuantity(tx.value) + gas * price) throw new Error('miningGasBalance')
  await checkWallet()
  if (!validMiningProductCall(tx, c.deployment, true)) throw new Error('miningInvalidAction')
  c.onStage('miningWallet')
  let hash: unknown
  try { hash = await c.identity.provider.request({ method: 'eth_sendTransaction', params: [{ ...tx, chainId: toHex(c.deployment.chainId), gas: toHex(gas), gasPrice: toHex(price) }] }) }
  catch (cause) {
    if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 4001) throw new Error('miningRejected')
    // A transport rejection may occur AFTER broadcast. Never turn it into a retryable plan.
    throw new Error('miningSubmissionUnknown')
  }
  if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('miningSubmissionUnknown')
  const submitted: MiningSubmission = { hash: hash as Hex, from: tx.from, to: tx.to, action, at: Date.now(), status: 'pending', approval }
  // The hash must survive account/network changes during the wallet confirmation.
  c.onSubmission({ ...submitted }); c.onStage('miningConfirming')
  if (c.wait) submitted.status = await c.wait(submitted.hash, tx)
  else {
    for (let attempt = 0; attempt < 30; attempt++) {
      try { if (await receiptStatus(c.read, submitted.hash, tx.from, tx.to) === 'success') { submitted.status = 'success'; break } }
      catch (error) {
        if (error instanceof Error && error.message === 'tradeReverted') { submitted.status = 'reverted'; break }
        break // Keep the hash; a transport failure does not authorize a resend.
      }
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }
  c.onSubmission({ ...submitted })
  if (submitted.status === 'reverted') throw new Error('miningReverted')
  if (submitted.status === 'pending') throw new Error('miningPending')
  if (approval) assertCurrent()
  c.onStage('miningSuccess')
  return submitted
}
