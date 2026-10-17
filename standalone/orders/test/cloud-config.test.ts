import { describe, expect, it } from 'vitest'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { cloudConfig } from '../cloudflare/config.ts'
const base = { ORDERS: { idFromName: (): string => 'unused', get: (): never => { throw Error('not called') } }, ORDERS_PUBLIC_ORIGIN: 'https://orders.test' }
describe('explicit Cloudflare execution configuration', () => {
  it('keeps the tracked null settlement disabled without a key, budget or polling configuration', () => {
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
    expect(correct.config.executionEnabled).toBe(false) // A key never overrides the reviewed null deployment.
  })
})
