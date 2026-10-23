import { readFile } from 'node:fs/promises'
import { getAddress, keccak256, pad, type Hex } from 'viem'
import { V2, V2_FACTORY, V2_ROUTER_READ } from '../../v2-protocol'
import { call } from '../src/liquidity/rpc'
import type { PublicRpc } from '../src/liquidity/types'

/** Install verified runtimes into an exclusively owned, offline Anvil. Pair creation stays real CREATE2. */
export async function installV2Fixture(request: (method: string, params?: unknown[]) => Promise<unknown>, runtimePath: string, owner: Hex): Promise<void> {
  if (!String(await request('web3_clientVersion')).toLowerCase().includes('anvil') || await request('eth_chainId') !== '0xc4') throw Error('Owned Anvil required')
  const runtimes = JSON.parse(await readFile(runtimePath, 'utf8')) as Record<'v2Factory' | 'router', { address: Hex; runtime: Hex; runtimeKeccak256: Hex }>
  for (const role of ['v2Factory', 'router'] as const) {
    const item = runtimes[role], expected = role === 'v2Factory' ? V2.factory : V2.router
    if (getAddress(item.address) !== getAddress(expected) || keccak256(item.runtime) !== item.runtimeKeccak256 ||
      await request('eth_getCode', [expected, 'latest']) !== '0x') throw Error('Conflicting V2 fixture runtime')
    await request('anvil_setCode', [expected, item.runtime])
  }
  await request('anvil_setStorageAt', [V2.factory, pad('0x01'), pad(owner)])
  const read = request as PublicRpc
  if (getAddress(await call(V2_ROUTER_READ, V2.router, 'factory', [], read) as Hex) !== getAddress(V2.factory) ||
    getAddress(await call(V2_ROUTER_READ, V2.router, 'WETH', [], read) as Hex) !== getAddress(V2.wrapped) ||
    await call(V2_FACTORY, V2.factory, 'allPairsLength', [], read) !== 0n) throw Error('Invalid V2 fixture binding')
}
