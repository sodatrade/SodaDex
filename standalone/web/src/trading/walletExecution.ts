import { toHex, type Hex } from 'viem'
import { CHAIN_ID } from '../domain/assets'
import { hexQuantity, rpc } from '../lib/rpc'
import { firstAccount } from '../lib/wallet'
import { publicSwapsEnabled } from './config'
import { transactionHash, waitReceipt } from './receipts'
import { TradeError, type PublicRpc, type TradeIdentity, type TradeProgress, type TradeStage, type Transaction } from './types'

export interface ExecutionContext {
  identity: TradeIdentity
  getIdentity: () => TradeIdentity | undefined
  isCurrentForm: () => boolean
  onProgress: (progress: TradeProgress) => void
  read?: PublicRpc
  wait?: typeof waitReceipt
  ready?: boolean
}
export interface ExecutionSession {
  read: PublicRpc
  assertCurrent: () => void
  progress: (stage: TradeStage) => void
  send: (tx: Transaction, stage: TradeStage, kind: 'approval' | 'swap', options?: { validateBooleanReturn?: boolean }) => Promise<Hex>
  checkNetwork: () => Promise<void>
}
export interface ExecutionOptions {
  /** Swaps use the public-trading switch; independent wallet actions opt out explicitly. */
  requiresPublicSwaps?: boolean
}
export function identityGuard(c: ExecutionContext): () => void {
  return () => {
    const now = c.getIdentity()
    if (
      !c.isCurrentForm() ||
      !now ||
      now.provider !== c.identity.provider ||
      now.address.toLowerCase() !== c.identity.address.toLowerCase() ||
      now.chainId !== CHAIN_ID ||
      now.revision !== c.identity.revision
    )
      throw new TradeError('tradeIdentityChanged')
  }
}
/** Shared wallet boundary for legacy swaps, discovered-pool swaps and native wrapping. */
export function createExecutionSession(c: ExecutionContext, options: ExecutionOptions = {}): ExecutionSession {
  const requiresPublicSwaps = options.requiresPublicSwaps !== false
  const assertPolicy = (): void => {
    if (requiresPublicSwaps && !publicSwapsEnabled()) throw new TradeError('tradePaused')
  }
  assertPolicy()
  const read = c.read ?? rpc
  const wait = c.wait ?? waitReceipt
  const assertIdentity = identityGuard(c)
  const assertCurrent = (): void => {
    assertPolicy()
    assertIdentity()
  }
  const identity = c.identity
  assertCurrent()
  const checkWallet = async (): Promise<void> => {
    assertCurrent()
    const accounts = await identity.provider.request({ method: 'eth_accounts' })
    assertCurrent()
    if (firstAccount(accounts)?.toLowerCase() !== identity.address.toLowerCase())
      throw new TradeError('tradeIdentityChanged')
    const chain = await identity.provider.request({ method: 'eth_chainId' })
    assertCurrent()
    if (hexQuantity(chain) !== BigInt(CHAIN_ID)) throw new TradeError('tradeIdentityChanged')
  }
  const progress = (stage: TradeStage): void => c.onProgress({ stage })
  const checkNetwork = async (): Promise<void> => {
    if (hexQuantity(await read('eth_chainId')) !== BigInt(CHAIN_ID)) throw new TradeError('tradeUnavailable')
    assertCurrent()
  }
  const send: ExecutionSession['send'] = async (tx, stage, kind, sendOptions) => {
    await checkWallet()
    progress(stage)
    const simulated = await read('eth_call', [tx, 'latest'])
    assertCurrent()
    if (typeof simulated !== 'string' || !/^0x[0-9a-fA-F]*$/.test(simulated)) throw new TradeError('tradeFailed')
    // ERC-20 approve must not silently return false. Empty-return USDT tokens remain supported.
    if (kind === 'approval' && simulated !== '0x' && hexQuantity(simulated) === 0n)
      throw new TradeError('tradeReverted')
    if (sendOptions?.validateBooleanReturn && simulated !== '0x') {
      if (!/^0x[0-9a-fA-F]{64}$/.test(simulated)) throw new TradeError('tradeFailed')
      if (hexQuantity(simulated) === 0n) throw new TradeError('tradeReverted')
      if (hexQuantity(simulated) !== 1n) throw new TradeError('tradeFailed')
    }
    const gas = hexQuantity(await read('eth_estimateGas', [tx]))
    assertCurrent()
    if (gas <= 0n) throw new TradeError('tradeFailed')
    const gasPrice = hexQuantity(await read('eth_gasPrice'))
    assertCurrent()
    const balance = hexQuantity(await read('eth_getBalance', [identity.address, 'latest']))
    assertCurrent()
    if (balance < hexQuantity(tx.value) + gas * gasPrice) throw new TradeError('tradeGasBalance')
    await checkWallet()
    assertCurrent()
    const hash = transactionHash(
      await identity.provider.request({
        method: 'eth_sendTransaction',
        params: [{ ...tx, chainId: toHex(CHAIN_ID), gas: toHex(gas) }],
      }),
    )
    // Preserve the submitted hash even when the wallet changes while its confirmation window is open.
    c.onProgress({ stage: 'tradeConfirming', hash, kind, to: tx.to })
    try {
      await wait(read, hash, identity.address, tx.to)
    } catch (cause) {
      c.onProgress({ stage: 'tradeConfirming', hash, kind, to: tx.to })
      throw cause
    }
    if (kind === 'approval') assertCurrent()
    return hash
  }
  return { read, assertCurrent, progress, send, checkNetwork }
}
