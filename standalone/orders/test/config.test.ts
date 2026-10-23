import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Address } from 'viem'
import undeployed from './fixtures/orders-undeployed.json' with { type: 'json' }
import ready from './fixtures/orders-ready.json' with { type: 'json' }
const reviewed = vi.hoisted(() => ({ manifest: {} as Record<string, unknown> }))
vi.mock('../../../deployments/orders-test.json', () => ({ default: reviewed.manifest }))
import { FIXED, validateConfig } from '../src/config.ts'
import { environment, settlement } from './fixture.ts'
beforeEach(() => { Object.assign(reviewed.manifest, undeployed) })
describe('explicit order service configuration', () => {
  it('blocks alternate remote RPC, undeployed remote settlement and credential-bearing origins', () => {
    const env = environment()
    try {
      expect(() => validateConfig({ ...env.config, localTest: false, settlement: null, rpcUrl: 'https://attacker.example' })).toThrow()
      expect(() => validateConfig({ ...env.config, localTest: false, settlement, rpcUrl: FIXED.rpcUrl })).toThrow()
      expect(() => validateConfig({ ...env.config, publicOrigin: 'https://user:password@example.com' })).toThrow()
      expect(() => validateConfig({ ...env.config, rpcUrl: 'http://127.0.0.1:31337/?rpc=remote' })).toThrow()
      expect(() => validateConfig({ ...env.config, rpcUrl: 'http://localhost:31337/' })).toThrow()
    } finally { env.cleanup() }
  })
  it('requires a positive explicit execution budget and configured settlement', () => {
    const env = environment()
    try {
      expect(() => validateConfig({ ...env.config, executionEnabled: true, gasBudgetWei: 0n })).toThrow()
      expect(() => validateConfig({ ...env.config, executionEnabled: true, settlement: null, gasBudgetWei: 1n })).toThrow()
      expect(() => validateConfig({ ...env.config, gasBudgetWei: -1n })).toThrow()
      expect(validateConfig({ ...env.config, localTest: false, settlement: null, rpcUrl: FIXED.rpcUrl }).executionEnabled).toBe(false)
    } finally { env.cleanup() }
  })
  it('accepts only the matching ready test fixture for a remote runtime without making RPC calls', () => {
    Object.assign(reviewed.manifest, ready)
    const env = environment()
    try {
      const remote = { ...env.config, localTest: false, settlement: ready.settlement as Address, rpcUrl: FIXED.rpcUrl, executionEnabled: true, gasBudgetWei: 1n }
      expect(validateConfig(remote)).toMatchObject({ settlement: ready.settlement, executionEnabled: true })
      expect(() => validateConfig({ ...remote, settlement })).toThrow('Remote settlement must match')
      expect(() => validateConfig({ ...remote, settlement: null })).toThrow('Remote settlement must match')
    } finally { env.cleanup() }
  })
})
