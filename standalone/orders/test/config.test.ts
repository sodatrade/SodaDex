import { describe, expect, it } from 'vitest'
import { FIXED, validateConfig } from '../src/config.ts'
import { environment, settlement } from './fixture.ts'
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
})
