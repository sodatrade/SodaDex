import { encodeAbiParameters, encodeFunctionData, zeroAddress, type Address, type Hex } from 'viem'
import { keyType, v3ManagerAbi, v4ManagerAbi } from './abis'
import { LP_CONTRACTS } from './config'
import { poolKey } from './pools'
import type { LiquidityPreview } from './types'
const max128 = (1n << 128n) - 1n
export function buildLiquidityTransaction(
  p: Omit<LiquidityPreview, 'transaction' | 'approvals'>,
): LiquidityPreview['transaction'] {
  const { pool, operation: op, owner, deadline } = p
  const native0 = pool.currency0.native,
    native1 = pool.currency1.native
  const adding = op.kind === 'mint' || op.kind === 'increase'
  const value = adding ? (native0 ? p.maximum0 : native1 ? p.maximum1 : 0n) : 0n
  let data: Hex
  if (pool.protocol === 'v3') {
    const calls: Hex[] = []
    if (op.kind === 'mint') {
      if (!op.pool.initialized)
        calls.push(
          encodeFunctionData({
            abi: v3ManagerAbi,
            functionName: 'createAndInitializePoolIfNecessary',
            args: [pool.currency0.address, pool.currency1.address, pool.fee, pool.sqrtPriceX96],
          }),
        )
      calls.push(
        encodeFunctionData({
          abi: v3ManagerAbi,
          functionName: 'mint',
          args: [
            {
              token0: pool.currency0.address,
              token1: pool.currency1.address,
              fee: pool.fee,
              tickLower: op.tickLower,
              tickUpper: op.tickUpper,
              amount0Desired: p.maximum0,
              amount1Desired: p.maximum1,
              amount0Min: p.minimum0,
              amount1Min: p.minimum1,
              recipient: owner,
              deadline,
            },
          ],
        }),
      )
    } else if (op.kind === 'increase')
      calls.push(
        encodeFunctionData({
          abi: v3ManagerAbi,
          functionName: 'increaseLiquidity',
          args: [
            {
              tokenId: op.position.tokenId,
              amount0Desired: p.maximum0,
              amount1Desired: p.maximum1,
              amount0Min: p.minimum0,
              amount1Min: p.minimum1,
              deadline,
            },
          ],
        }),
      )
    else {
      if (op.kind === 'decrease')
        calls.push(
          encodeFunctionData({
            abi: v3ManagerAbi,
            functionName: 'decreaseLiquidity',
            args: [
              {
                tokenId: op.position.tokenId,
                liquidity: p.liquidity,
                amount0Min: p.minimum0,
                amount1Min: p.minimum1,
                deadline,
              },
            ],
          }),
        )
      calls.push(
        encodeFunctionData({
          abi: v3ManagerAbi,
          functionName: 'collect',
          args: [
            {
              tokenId: op.position.tokenId,
              recipient: native0 || native1 ? zeroAddress : owner,
              amount0Max: max128,
              amount1Max: max128,
            },
          ],
        }),
      )
      if (native0 || native1) {
        calls.push(encodeFunctionData({ abi: v3ManagerAbi, functionName: 'unwrapWETH9', args: [0n, owner] }))
        calls.push(
          encodeFunctionData({
            abi: v3ManagerAbi,
            functionName: 'sweepToken',
            args: [native0 ? pool.currency1.address : pool.currency0.address, 0n, owner],
          }),
        )
      }
    }
    if (adding && (native0 || native1)) calls.push(encodeFunctionData({ abi: v3ManagerAbi, functionName: 'refundETH' }))
    data = encodeFunctionData({ abi: v3ManagerAbi, functionName: 'multicall', args: [calls] })
  } else {
    let actions: Hex
    const parameters: Hex[] = []
    const key = poolKey(pool)
    if (op.kind === 'mint') {
      actions = '0x020d14'
      parameters.push(
        encodeAbiParameters(
          [
            keyType,
            { type: 'int24' },
            { type: 'int24' },
            { type: 'uint256' },
            { type: 'uint128' },
            { type: 'uint128' },
            { type: 'address' },
            { type: 'bytes' },
          ],
          [key, op.tickLower, op.tickUpper, p.liquidity, p.maximum0, p.maximum1, owner, '0x'],
        ),
      )
    } else if (op.kind === 'increase') {
      actions = '0x00121214'
      parameters.push(
        encodeAbiParameters(
          [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint128' }, { type: 'uint128' }, { type: 'bytes' }],
          [op.position.tokenId, p.liquidity, p.maximum0, p.maximum1, '0x'],
        ),
      )
    } else {
      actions = '0x0111'
      parameters.push(
        encodeAbiParameters(
          [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint128' }, { type: 'uint128' }, { type: 'bytes' }],
          [op.position.tokenId, p.liquidity, p.minimum0, p.minimum1, '0x'],
        ),
      )
    }
    if (op.kind === 'increase') {
      parameters.push(encodeAbiParameters([{ type: 'address' }], [pool.currency0.address]))
      parameters.push(encodeAbiParameters([{ type: 'address' }], [pool.currency1.address]))
      parameters.push(encodeAbiParameters([{ type: 'address' }, { type: 'address' }], [zeroAddress, owner]))
    } else if (adding) {
      parameters.push(
        encodeAbiParameters(
          [{ type: 'address' }, { type: 'address' }],
          [pool.currency0.address, pool.currency1.address],
        ),
      )
      parameters.push(encodeAbiParameters([{ type: 'address' }, { type: 'address' }], [zeroAddress, owner]))
    } else
      parameters.push(
        encodeAbiParameters(
          [{ type: 'address' }, { type: 'address' }, { type: 'address' }],
          [pool.currency0.address, pool.currency1.address, owner],
        ),
      )
    const unlock = encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], [actions, parameters])
    const modify = encodeFunctionData({
      abi: v4ManagerAbi,
      functionName: 'modifyLiquidities',
      args: [unlock, deadline],
    })
    data =
      op.kind === 'mint' && !op.pool.initialized
        ? encodeFunctionData({
            abi: v4ManagerAbi,
            functionName: 'multicall',
            args: [
              [
                encodeFunctionData({
                  abi: v4ManagerAbi,
                  functionName: 'initializePool',
                  args: [key, pool.sqrtPriceX96],
                }),
                modify,
              ],
            ],
          })
        : modify
  }
  return {
    from: owner,
    to: pool.protocol === 'v3' ? LP_CONTRACTS.v3Manager : LP_CONTRACTS.v4Manager,
    data,
    value: `0x${value.toString(16)}`,
  }
}
export function liquidityManager(protocol: 'v3' | 'v4'): Address {
  return protocol === 'v3' ? LP_CONTRACTS.v3Manager : LP_CONTRACTS.v4Manager
}
