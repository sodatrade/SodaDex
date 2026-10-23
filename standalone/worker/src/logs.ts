import { V2, V2_FACTORY } from '../../v2-protocol'
import { toEventSelector } from 'viem'
import { deployment, EVENTS, FIRST_BLOCK, PAGE_BLOCKS, pools, record, same } from './contracts'
const HASH = /^0x[0-9a-fA-F]{64}$/
const BLOCK = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/
const ADDRESSES = [V2.factory, deployment.contracts.v3Factory, deployment.contracts.v3PositionManager, deployment.contracts.v4PoolManager, deployment.contracts.v4PositionManager, pools.v3.address]
export const EVENT_TOPICS = [...EVENTS.map((event) => toEventSelector(event)), toEventSelector(V2_FACTORY[4])]
export function validLogFilter(value: unknown): boolean {
  if (!record(value) || Object.keys(value).some((key) => !['address', 'fromBlock', 'toBlock', 'topics'].includes(key))) return false
  if (typeof value.fromBlock !== 'string' || typeof value.toBlock !== 'string' || !BLOCK.test(value.fromBlock) || !BLOCK.test(value.toBlock)) return false
  const from = BigInt(value.fromBlock), to = BigInt(value.toBlock)
  if (from < BigInt(FIRST_BLOCK) || to < from || to - from >= BigInt(PAGE_BLOCKS)) return false
  const addresses = Array.isArray(value.address) ? value.address : [value.address]
  if (!addresses.length || addresses.length > 5 || !addresses.every((address) => typeof address === 'string' && ADDRESSES.some((allowed) => same(allowed, address)))) return false
  if (!Array.isArray(value.topics) || !value.topics.length || value.topics.length > 4) return false
  return value.topics.every((topic, index) => {
    const topics = Array.isArray(topic) ? topic : [topic]
    return topics.length <= 10 && topics.every((item) => index === 0 ? typeof item === 'string' && EVENT_TOPICS.some((allowed) => same(allowed, item)) : item === null || (typeof item === 'string' && HASH.test(item)))
  })
}
