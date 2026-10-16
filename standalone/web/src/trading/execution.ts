import { toHex, type Address, type Hex } from 'viem'
import { CHAIN_ID } from '../domain/assets'
import { hexQuantity, rpc } from '../lib/rpc'
import { firstAccount } from '../lib/wallet'
import { ensureApprovals } from './approvals'
import { DEADLINE_SECONDS, POOLS } from './config'
import { buildSwap } from './encoding'
import { latestTimestamp, quoteRoute } from './quotes'
import { transactionHash, waitReceipt } from './receipts'
import {
  TradeError,
  type PublicRpc,
  type Quote,
  type TradeIdentity,
  type TradeProgress,
  type TradeStage,
  type Transaction,
} from './types'

export interface ExecutionContext {
  identity: TradeIdentity
  getIdentity: () => TradeIdentity | undefined
  isCurrentForm: () => boolean
  onProgress: (progress: TradeProgress) => void
  read?: PublicRpc
  wait?: typeof waitReceipt
  ready?: boolean
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
/** Every wallet write is preceded by provider identity validation and a same-origin simulation. */
export async function executeTrade(review: Quote, c: ExecutionContext): Promise<Hex> {
  if (!(c.ready ?? POOLS.ready)) throw new TradeError('tradeNotReady')
  const read = c.read ?? rpc
  const wait = c.wait ?? waitReceipt
  const assertCurrent = identityGuard(c)
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
  const send = async (tx: Transaction, stage: TradeStage, kind: 'approval' | 'swap'): Promise<Hex> => {
    await checkWallet()
    progress(stage)
    const simulated = await read('eth_call', [tx, 'latest'])
    assertCurrent()
    if (typeof simulated !== 'string' || !/^0x[0-9a-fA-F]*$/.test(simulated)) throw new TradeError('tradeFailed')
    // ERC-20 approve must not silently return false. Empty-return USDT tokens remain supported.
    if (kind === 'approval' && simulated !== '0x' && hexQuantity(simulated) === 0n)
      throw new TradeError('tradeReverted')
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
  progress('tradePreparing')
  if (hexQuantity(await read('eth_chainId')) !== BigInt(CHAIN_ID)) throw new TradeError('tradeUnavailable')
  assertCurrent()
  let deadline = (await latestTimestamp(read)) + DEADLINE_SECONDS
  assertCurrent()
  if (review.from === 'usdt0') {
    const expiration = await ensureApprovals({
      owner: identity.address,
      amount: review.amount,
      expiry: deadline,
      read,
      assertCurrent,
      send: async (to: Address, data: Hex, stage: TradeStage) => {
        await send({ from: identity.address, to, data, value: '0x0' }, stage, 'approval')
      },
    })
    assertCurrent()
    deadline = deadline < expiration ? deadline : expiration
  }
  progress('tradeRefreshing')
  const refreshed = await quoteRoute(review, review.protocol, read)
  assertCurrent()
  if (refreshed.amountOut < review.minimumOut) throw new TradeError('tradeQuoteChanged')
  // The user's reviewed minimum is a floor across all subsequent quotes and approvals.
  const finalQuote = {
    ...refreshed,
    minimumOut: refreshed.minimumOut > review.minimumOut ? refreshed.minimumOut : review.minimumOut,
  }
  const timestamp = await latestTimestamp(read)
  assertCurrent()
  if (timestamp >= deadline) throw new TradeError('tradeExpired')
  const tx = buildSwap(finalQuote, identity.address, deadline)
  progress('tradeSimulating')
  const hash = await send(tx, 'tradeSending', 'swap')
  c.onProgress({ stage: 'tradeSucceeded', hash, kind: 'swap' })
  return hash
}
