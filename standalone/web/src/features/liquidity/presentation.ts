import { formatUnits, type Address } from 'viem'
import { parseAmount } from '../../domain/amount'
import { STABLE_ADDRESS, WOKB_ADDRESS, type AssetId } from '../../domain/assets'
import type { LiquidityMessageKey } from '../../i18n/liquidity'
import { LiquidityError, type Currency, type LiquidityStage } from '../../liquidity/types'
export const stageMessage: Record<LiquidityStage, LiquidityMessageKey> = {
  preparing: 'stagePreparing',
  resetApproval: 'stageResetApproval',
  tokenApproval: 'stageTokenApproval',
  permitApproval: 'stagePermitApproval',
  simulating: 'stageSimulating',
  sending: 'stageSending',
  pending: 'stagePending',
  success: 'stageSuccess',
}
export function tokenAmount(amount: bigint, currency: Currency): string {
  return `${formatUnits(amount, currency.decimals)} ${currency.symbol}`
}
export function decimalInput(value: string, decimals: number): bigint {
  const amount = parseAmount(value, decimals)
  if (amount.kind === 'invalid' && amount.error.code === 'amountZero') return 0n
  if (amount.kind !== 'valid') throw new LiquidityError('invalidAmount')
  return amount.units
}
export function integerInput(value: string): number {
  if (!/^-?\d+$/.test(value)) throw new LiquidityError('invalidRange')
  const number = Number(value)
  if (!Number.isSafeInteger(number)) throw new LiquidityError('invalidRange')
  return number
}
export function assetId(currency: Currency): AssetId | undefined {
  if (currency.native) return 'okb'
  const address = currency.address.toLowerCase()
  return address === STABLE_ADDRESS.toLowerCase()
    ? 'usdt0'
    : address === WOKB_ADDRESS.toLowerCase()
      ? 'wokb'
      : undefined
}
export const sameAddress = (a: Address | string, b: Address | string): boolean => a.toLowerCase() === b.toLowerCase()
