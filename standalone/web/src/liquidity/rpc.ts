import { decodeFunctionResult, encodeFunctionData, type Abi, type Address, type Hex } from 'viem'
import { LiquidityError, type PublicRpc } from './types'
export async function call(
  abi: Abi,
  to: Address,
  name: string,
  args: readonly unknown[],
  read: PublicRpc,
  block = 'latest',
): Promise<unknown> {
  const data = encodeFunctionData({ abi, functionName: name, args })
  const result = await read('eth_call', [{ to, data }, block])
  if (typeof result !== 'string' || !/^0x[0-9a-fA-F]*$/.test(result)) throw new LiquidityError('failed')
  return decodeFunctionResult({ abi, functionName: name, data: result as Hex })
}
