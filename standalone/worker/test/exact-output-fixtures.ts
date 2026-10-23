import { encodeAbiParameters, type Address } from 'viem'
import { deployment, ZERO } from '../src/contracts'
import { ACTIONS, custody, execute, nativeSweep, owner, pair, SWAP3, SWAP4, tokenA, tokenB, transaction, type Transaction } from './trade-fixtures'
export function exact3(input: Address = tokenA, output: Address = tokenB, mode: 'tokens' | 'nativeIn' | 'nativeOut' = 'tokens'): Transaction {
  const path = `${output}0001f4${input.slice(2)}` as const
  const swap = encodeAbiParameters(SWAP3, [mode === 'nativeOut' ? custody : owner, 50n, 100n, path, mode !== 'nativeIn', []])
  if (mode === 'tokens') return transaction(execute('0x01', [swap]))
  const unwrap = encodeAbiParameters(pair, [owner, mode === 'nativeIn' ? 0n : 50n])
  return mode === 'nativeIn'
    ? transaction(execute('0x0b010c04', [encodeAbiParameters(pair, [custody, 100n]), swap, unwrap, nativeSweep()]), '0x64')
    : transaction(execute('0x010c04', [swap, unwrap, nativeSweep()]))
}
export function exact4(input: Address = tokenA, output: Address = tokenB): Transaction {
  const currencies = BigInt(input) < BigInt(output) ? [input, output] : [output, input]
  const key = [currencies[0], currencies[1], 500, 10, ZERO] as const
  const swap = encodeAbiParameters(SWAP4, [[key, input === currencies[0], 50n, 100n, 0n, '0x']])
  return transaction(execute('0x1004', [encodeAbiParameters(ACTIONS, ['0x080c0f', [swap,
    encodeAbiParameters(pair, [input, 100n]), encodeAbiParameters(pair, [output, 50n])]]), nativeSweep()]), input === ZERO ? '0x64' : '0x0')
}
export const wrapped = deployment.wrappedNative as Address
