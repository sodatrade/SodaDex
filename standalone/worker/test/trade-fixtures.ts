import { encodeAbiParameters, encodeFunctionData, parseAbi, parseAbiParameters, type Address, type Hex } from 'viem'
import { deployment, ZERO } from '../src/contracts'
export const owner = deployment.owner as Address
export const tokenA = '0x1111111111111111111111111111111111111111'
export const tokenB = '0x2222222222222222222222222222222222222222'
export const custody = '0x0000000000000000000000000000000000000002'
export const pair = parseAbiParameters('address,uint256')
export const SWAP3 = parseAbiParameters('address,uint256,uint256,bytes,bool,uint256[]')
export const SWAP4 = parseAbiParameters('((address,address,uint24,int24,address),bool,uint128,uint128,uint256,bytes)')
export const ACTIONS = parseAbiParameters('bytes,bytes[]')
export const EXECUTE = parseAbi(['function execute(bytes,bytes[],uint256) payable'])
export const nativeSweep = (recipient: Address = owner): Hex => encodeAbiParameters(parseAbiParameters('address,address,uint256'), [ZERO, recipient, 0n])
export const execute = (commands: Hex, inputs: readonly Hex[]): Hex => encodeFunctionData({ abi: EXECUTE, functionName: 'execute', args: [commands, inputs, 2_000_000_000n] })
export interface Transaction { from: Address; to: string; data: Hex; value: Hex }
export const transaction = (data: Hex, value: Hex = '0x0'): Transaction => ({ from: owner, to: deployment.contracts.universalRouter, data, value })
export function v3(input: Address = tokenA, output: Address = tokenB, fee = 3000, mode: 'tokens' | 'nativeIn' | 'nativeOut' = 'tokens'): Transaction {
  const path = `${input}${fee.toString(16).padStart(6, '0')}${output.slice(2)}` as Hex
  const swap = encodeAbiParameters(SWAP3, [mode === 'nativeOut' ? custody : owner, 100n, 90n, path, mode !== 'nativeIn', []])
  if (mode === 'tokens') return transaction(execute('0x00', [swap]))
  const unwrap = encodeAbiParameters(pair, [owner, mode === 'nativeIn' ? 0n : 90n])
  return mode === 'nativeIn'
    ? transaction(execute('0x0b000c04', [encodeAbiParameters(pair, [custody, 100n]), swap, unwrap, nativeSweep()]), '0x64')
    : transaction(execute('0x000c04', [swap, unwrap, nativeSweep()]))
}
export function v4(input: Address = tokenA, output: Address = tokenB, fee = 500, tickSpacing = 10, hooks: Address = ZERO): Transaction {
  const currencies = BigInt(input) < BigInt(output) ? [input, output] : [output, input]
  const zeroForOne = input === currencies[0]
  const key = [currencies[0], currencies[1], fee, tickSpacing, hooks] as const
  const swap = encodeAbiParameters(SWAP4, [[key, zeroForOne, 100n, 90n, 0n, '0x']])
  const actions = encodeAbiParameters(ACTIONS, ['0x060c0f', [swap, encodeAbiParameters(pair, [input, 100n]), encodeAbiParameters(pair, [output, 90n])]])
  return transaction(execute('0x1004', [actions, nativeSweep()]), input === ZERO ? '0x64' : '0x0')
}
export function request(tx: Transaction, method = 'eth_call', block = '0x12345'): Request {
  return new Request('https://soda.example/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 7, method, params: method === 'eth_call' ? [tx, block] : [tx] }) })
}
