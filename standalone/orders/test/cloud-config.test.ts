import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import undeployed from './fixtures/orders-undeployed.json' with { type: 'json' }
import ready from './fixtures/orders-ready.json' with { type: 'json' }
const reviewed = vi.hoisted(() => ({ manifest: {} as Record<string, unknown> }))
vi.mock('../../../deployments/orders-test.json', () => ({ default: reviewed.manifest }))
import { actorName, cloudConfig } from '../cloudflare/config.ts'
const base = { ORDERS: { idFromName: (): string => 'unused', get: (): never => { throw Error('not called') } }, ORDERS_PUBLIC_ORIGIN: 'https://orders.test' }
beforeEach(() => { Object.assign(reviewed.manifest, undeployed) })
describe('explicit Cloudflare execution configuration', () => {
  it('keeps an undeployed fixture disabled without a key, budget or polling configuration', () => {
    const result = cloudConfig(base)
    expect(result.config.settlement).toBeNull()
    expect(result.config.executionEnabled).toBe(false)
    expect(result.config.gasBudgetWei).toBe(0n)
    expect(result.signer).toBeUndefined(); expect(result.pollMs).toBeNull()
  })
  it('rejects mismatched keeper bindings without exposing their private input', () => {
    const key = generatePrivateKey()
    expect(() => cloudConfig({ ...base, ORDERS_KEEPER_PRIVATE_KEY: key })).toThrow('Dedicated keeper configuration')
    expect(() => cloudConfig({ ...base, ORDERS_KEEPER_PRIVATE_KEY: key, ORDERS_KEEPER_ADDRESS: '0x2222222222222222222222222222222222222222' })).toThrow('address mismatch')
    const correct = cloudConfig({ ...base, ORDERS_KEEPER_PRIVATE_KEY: key, ORDERS_KEEPER_ADDRESS: privateKeyToAccount(key).address, ORDERS_EXECUTION_ENABLED: 'true', ORDERS_POLL_MS: '1000', ORDERS_GAS_BUDGET_WEI: '1' })
    expect(correct.config.executionEnabled).toBe(false) // A key never overrides the reviewed undeployed fixture.
  })
  it('enables only an explicitly ready fixture with a matching keeper, polling and budget', () => {
    Object.assign(reviewed.manifest, ready)
    const key = generatePrivateKey()
    const env = { ...base, ORDERS_KEEPER_PRIVATE_KEY: key, ORDERS_KEEPER_ADDRESS: privateKeyToAccount(key).address, ORDERS_EXECUTION_ENABLED: 'true', ORDERS_POLL_MS: '1000', ORDERS_GAS_BUDGET_WEI: '1' }
    expect(cloudConfig(env).config).toMatchObject({ settlement: ready.settlement, executionEnabled: true, gasBudgetWei: 1n })
    expect(actorName()).toBe(`sodadex-orders:196:${ready.settlement}`)
    expect(cloudConfig({ ...env, ORDERS_EXECUTION_ENABLED: 'false' }).config.executionEnabled).toBe(false)
    expect(cloudConfig({ ...env, ORDERS_GAS_BUDGET_WEI: '0' }).config.executionEnabled).toBe(false)
    expect(cloudConfig({ ...env, ORDERS_POLL_MS: undefined }).config.executionEnabled).toBe(false)
    expect(cloudConfig({ ...env, ORDERS_KEEPER_PRIVATE_KEY: undefined }).config.executionEnabled).toBe(false)
  })
})
