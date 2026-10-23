import { decodeFunctionResult, encodeFunctionData, toHex, type Address, type Hex } from 'viem'
import { hexQuantity, rpc } from '../lib/rpc'
import { firstAccount } from '../lib/wallet'
import { receiptStatus, transactionHash, waitReceipt } from '../trading/receipts'
import { TradeError, type Transaction } from '../trading/types'
import { nftAbi, permitAbi, tokenAbi } from './abis'
import { LP_CHAIN_ID, LP_CONTRACTS } from './config'
import { buildLiquidityTransaction, liquidityManager } from './encoding'
import { call } from './rpc'
import { refreshPool } from './pools'
import { getPosition } from './positions'
import {
  LiquidityError,
  type LiquidityErrorCode,
  type LiquidityExecutionContext,
  type LiquidityPreview,
  type LiquidityProgress,
  type LiquidityStage,
  type PublicRpc,
} from './types'
export function liquidityError(cause: unknown): LiquidityErrorCode {
  if (cause instanceof LiquidityError) return cause.code
  if (cause instanceof TradeError)
    return cause.code === 'tradePending' ? 'pending' : cause.code === 'tradeReverted' ? 'reverted' : 'failed'
  if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 4001) return 'rejected'
  return 'failed'
}
export async function recheckLiquidityReceipt(
  read: PublicRpc,
  hash: Hex,
  from: Address,
  to: Address,
): Promise<'pending' | 'success'> {
  return receiptStatus(read, hash, from, to)
}
export async function executeLiquidity(preview: LiquidityPreview, c: LiquidityExecutionContext): Promise<Hex> {
  const { identity } = c
  const assertCurrent = (): void => {
    const now = c.getIdentity()
    if (
      !now ||
      now.provider !== identity.provider ||
      now.address.toLowerCase() !== identity.address.toLowerCase() ||
      now.chainId !== LP_CHAIN_ID ||
      now.revision !== identity.revision ||
      c.isCurrentForm?.() === false ||
      preview.owner.toLowerCase() !== identity.address.toLowerCase()
    )
      throw new LiquidityError('identityChanged')
  }
  const rawRead = c.read ?? rpc
  const read: PublicRpc = async (method, params) => {
    assertCurrent()
    const result = await rawRead(method, params)
    assertCurrent()
    return result
  }
  const wait = c.wait ?? waitReceipt
  const progress = (stage: LiquidityStage, rest: Omit<LiquidityProgress, 'stage'> = {}): void =>
    c.onProgress({ stage, ...rest })
  assertCurrent()
  const canonical = buildLiquidityTransaction(preview)
  if (JSON.stringify(canonical) !== JSON.stringify(preview.transaction)) throw new LiquidityError('failed')
  if (hexQuantity(await read('eth_chainId')) !== BigInt(LP_CHAIN_ID)) throw new LiquidityError('identityChanged')
  const checkWallet = async (): Promise<void> => {
    assertCurrent()
    const accounts = await identity.provider.request({ method: 'eth_accounts' })
    assertCurrent()
    if (firstAccount(accounts)?.toLowerCase() !== identity.address.toLowerCase())
      throw new LiquidityError('identityChanged')
    const chain = await identity.provider.request({ method: 'eth_chainId' })
    assertCurrent()
    if (hexQuantity(chain) !== BigInt(LP_CHAIN_ID)) throw new LiquidityError('identityChanged')
  }
  const checkDeadline = async (): Promise<void> => {
    const b = await read('eth_getBlockByNumber', ['latest', false])
    if (!b || typeof b !== 'object' || !('timestamp' in b)) throw new LiquidityError('failed')
    if (hexQuantity(b.timestamp) >= preview.deadline) throw new LiquidityError('expired')
  }
  const send = async (tx: Transaction, stage: LiquidityStage, kind: 'approval' | 'liquidity'): Promise<Hex> => {
    await checkWallet()
    assertCurrent()
    await checkDeadline()
    assertCurrent()
    progress('simulating')
    const result = await read('eth_call', [tx, 'latest'])
    if (typeof result !== 'string' || !/^0x[0-9a-fA-F]*$/.test(result)) throw new LiquidityError('failed')
    if (kind === 'approval' && result !== '0x' && hexQuantity(result) === 0n) throw new LiquidityError('reverted')
    const gas = hexQuantity(await read('eth_estimateGas', [tx]))
    if (gas <= 0n) throw new LiquidityError('failed')
    const price = hexQuantity(await read('eth_gasPrice'))
    const balance = hexQuantity(await read('eth_getBalance', [identity.address, 'latest']))
    if (balance < hexQuantity(tx.value) + gas * price) throw new LiquidityError('gasBalance')
    await checkWallet()
    assertCurrent()
    await checkDeadline()
    assertCurrent()
    progress(stage)
    const hash = transactionHash(
      await identity.provider.request({
        method: 'eth_sendTransaction',
        params: [{ ...tx, chainId: toHex(LP_CHAIN_ID), gas: toHex(gas) }],
      }),
    )
    progress('pending', { hash, kind, to: tx.to })
    await wait(rawRead, hash, identity.address, tx.to)
    if (kind === 'approval') assertCurrent()
    return hash
  }
  const approve = async (to: Address, data: Hex, stage: LiquidityStage): Promise<void> => {
    await send({ from: identity.address, to, data, value: '0x0' }, stage, 'approval')
    assertCurrent()
  }
  progress('preparing')
  const adding = preview.operation.kind === 'mint' || preview.operation.kind === 'increase'
  if (adding)
    for (const [currency, amount] of [
      [preview.pool.currency0, preview.maximum0],
      [preview.pool.currency1, preview.maximum1],
    ] as const) {
      if (currency.native || amount === 0n) continue
      if (amount < 0n || amount >= 1n << (preview.pool.protocol === 'v4' ? 160n : 256n))
        throw new LiquidityError('invalidAmount')
      const v4 = preview.pool.protocol === 'v4',
        manager = liquidityManager(preview.pool.protocol),
        spender = v4 ? LP_CONTRACTS.permit2 : manager
      const allowance = async (): Promise<bigint> =>
        (await call(tokenAbi, currency.address, 'allowance', [identity.address, spender], read)) as bigint
      const current = await allowance()
      assertCurrent()
      if (current < amount) {
        if (current > 0n) {
          await approve(
            currency.address,
            encodeFunctionData({ abi: tokenAbi, functionName: 'approve', args: [spender, 0n] }),
            'resetApproval',
          )
          if ((await allowance()) !== 0n) throw new LiquidityError('failed')
        }
        await approve(
          currency.address,
          encodeFunctionData({ abi: tokenAbi, functionName: 'approve', args: [spender, amount] }),
          'tokenApproval',
        )
        if ((await allowance()) < amount) throw new LiquidityError('failed')
      }
      if (v4) {
        const data = encodeFunctionData({
          abi: permitAbi,
          functionName: 'allowance',
          args: [identity.address, currency.address, manager],
        })
        const permit = async (): Promise<readonly [bigint, number, number]> =>
          decodeFunctionResult({
            abi: permitAbi,
            functionName: 'allowance',
            data: (await read('eth_call', [{ to: LP_CONTRACTS.permit2, data }, 'latest'])) as Hex,
          })
        let [allowed, expiry] = await permit()
        assertCurrent()
        if (allowed < amount || BigInt(expiry) < preview.deadline) {
          await approve(
            LP_CONTRACTS.permit2,
            encodeFunctionData({
              abi: permitAbi,
              functionName: 'approve',
              args: [currency.address, manager, amount, Number(preview.deadline)],
            }),
            'permitApproval',
          )
          ;[allowed, expiry] = await permit()
          assertCurrent()
          if (allowed < amount || BigInt(expiry) < preview.deadline) throw new LiquidityError('failed')
        }
      }
    }
  await checkDeadline()
  assertCurrent()
  if (preview.operation.kind === 'mint' && !preview.operation.pool.initialized) {
    const current = await refreshPool(preview.operation.pool, read)
    assertCurrent()
    if (current.initialized) throw new LiquidityError('poolChanged')
  } else if (preview.operation.kind !== 'mint') {
    if (preview.operation.kind === 'burn') {
      const current = await getPosition(preview.operation.position.protocol, preview.operation.position.tokenId, read)
      assertCurrent()
      if (current.liquidity !== 0n || current.claimable0 !== 0n || current.claimable1 !== 0n) throw new LiquidityError('poolChanged')
    }
    const owner = await call(
      nftAbi,
      liquidityManager(preview.pool.protocol),
      'ownerOf',
      [preview.operation.position.tokenId],
      read,
    )
    assertCurrent()
    if (typeof owner !== 'string' || owner.toLowerCase() !== identity.address.toLowerCase())
      throw new LiquidityError('notOwner')
  }
  const hash = await send(canonical, 'sending', 'liquidity')
  progress('success', { hash, kind: 'liquidity', to: canonical.to })
  return hash
}
