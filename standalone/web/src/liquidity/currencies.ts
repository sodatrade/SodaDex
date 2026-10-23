import { getAddress, isAddress, zeroAddress, type Address } from 'viem'
import { WOKB_ADDRESS } from '../domain/assets'
import { rpc } from '../lib/rpc'
import { tokenAbi } from './abis'
import { KNOWN_CURRENCIES, NATIVE_CURRENCY } from './config'
import { call } from './rpc'
import { LiquidityError, type Currency, type LiquidityProtocol, type PublicRpc } from './types'
export function validateCurrency(c: Currency): Currency {
  if (
    !isAddress(c.address) ||
    !Number.isInteger(c.decimals) ||
    c.decimals < 0 ||
    c.decimals > 255 ||
    typeof c.symbol !== 'string' ||
    c.symbol.length > 64 ||
    typeof c.name !== 'string' ||
    c.name.length > 256 ||
    typeof c.native !== 'boolean' ||
    (c.native && c.address !== zeroAddress && c.address.toLowerCase() !== WOKB_ADDRESS.toLowerCase())
  )
    throw new LiquidityError('invalidCurrency')
  return { ...c, address: getAddress(c.address) }
}
export async function importCurrency(address: string, read: PublicRpc = rpc): Promise<Currency> {
  if (!isAddress(address)) throw new LiquidityError('invalidCurrency')
  const known = KNOWN_CURRENCIES.find((c) => c.address.toLowerCase() === address.toLowerCase())
  if (known) return { ...known }
  const code = await read('eth_getCode', [address, 'latest'])
  if (typeof code !== 'string' || code === '0x') throw new LiquidityError('invalidCurrency')
  const [decimals, symbol, name] = await Promise.all([
    call(tokenAbi, getAddress(address), 'decimals', [], read),
    call(tokenAbi, getAddress(address), 'symbol', [], read),
    call(tokenAbi, getAddress(address), 'name', [], read),
  ])
  return validateCurrency({
    address: getAddress(address),
    symbol: symbol as string,
    name: name as string,
    decimals: Number(decimals),
    native: false,
  })
}
export async function positionCurrency(
  address: Address,
  protocol: LiquidityProtocol,
  read: PublicRpc,
): Promise<Currency> {
  return protocol === 'v3' && address.toLowerCase() === WOKB_ADDRESS.toLowerCase()
    ? { ...NATIVE_CURRENCY, address: WOKB_ADDRESS }
    : importCurrency(address, read)
}
