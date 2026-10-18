import { describe, expect, it } from 'vitest'
import { Admission } from '../src/admission.ts'
import { Directory } from '../src/directory.ts'
import { handleRequest } from '../src/http.ts'
import { validateConfig, TEST_SIGNER } from '../src/config.ts'
import { cloudConfig } from '../cloudflare/config.ts'
import { fixture, d, signer, wallet, now } from './fixture.ts'
function setup() {
  const f = fixture(), app = { config: f.c, d, repo: f.repo, admission: new Admission(f.c, d, f.repo, f.rpc, f.discovery, signer, () => now),
    directory: new Directory(f.c, d, f.repo, f.rpc, f.discovery) }
  const request = (path: string, body?: unknown, headers?: HeadersInit) => new Request(`https://internal${path}`, {
    method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body),
    headers: { Origin: f.c.publicOrigin, 'X-SodaDEX-Network-Profile': '1952-mining-test', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
  })
  return { ...f, app, request }
}
describe('strict 1952 HTTP boundary and explicit config', () => {
  it('returns only public persisted project directory and budget/job snapshots without RPC calls', async () => {
    const f = setup(); f.repo.change(s => { s.authorizations.private = { nonce: '9', expiresAt: 1060 } })
    for (const path of ['/v1/projects', '/v1/status']) {
      const r = await handleRequest(f.request(path), f.app), text = await r.text()
      expect(r.status).toBe(200); expect(text).toContain(d.version); expect(text).not.toContain('authorizations'); expect(text).not.toContain('private')
    }
    expect(f.rpc.calls).toHaveLength(0)
  })
  it('enforces exact origin/profile, JSON shape and wallet signature bytes; denies arbitrary signing/calls', async () => {
    const f = setup()
    expect((await handleRequest(f.request('/v1/projects', undefined, { Origin: 'https://attacker.invalid' }), f.app)).status).toBe(403)
    expect((await handleRequest(f.request('/v1/run', { to: wallet.address, data: '0x1234' }), f.app)).status).toBe(400)
    expect((await handleRequest(f.request('/v1/launch', { requestId: 'x', address: wallet.address, signature: '0x' }), f.app)).status).toBe(400)
    expect((await handleRequest(f.request('/v1/sign', { digest: `0x${'11'.repeat(32)}` }), f.app)).status).toBe(404)
    expect((await handleRequest(f.request('/v1/challenge', { address: wallet.address, requestId: '11111111-1111-4111-8111-111111111111', action: 'launch', form: { name: 'A', symbol: 'A', metadataURI: '', graduation: '1' } }), f.app)).status).toBe(400)
    expect((await handleRequest(f.request('/v1/run', { padding: 'x'.repeat(9000) }), f.app)).status).toBe(413)
  })
  it('queues only a registered fixed project and persists across application recreation', async () => {
    const f = setup(), p = d.projects[0]
    const response = await handleRequest(f.request('/v1/run', { token: p.token.address }), f.app)
    expect(response.status).toBe(200); expect(f.repo.read().jobs[`project:${p.token.address.toLowerCase()}`].status).toBe('queued')
    expect(f.rpc.calls).toHaveLength(0)
  })
  it('keeps cloud defaults disabled and rejects implicit limits, wrong chain, signer and production endpoint', () => {
    const env = { MINING_PUBLIC_ORIGIN: 'https://test.example', MINING_1952: {} } as Parameters<typeof cloudConfig>[0]
    const result = cloudConfig(env)
    expect(result.config.admissionEnabled).toBe(false); expect(result.config.executionEnabled).toBe(false); expect(result.config.gasCapWei).toBe(0n); expect(result.config.policy).toBeNull()
    expect(() => cloudConfig({ ...env, MINING_EXECUTION_ENABLED: 'true' })).toThrow('policy_pending')
    expect(() => cloudConfig({ ...env, MINING_EXPIRED_RECOVERY_HASH: `0x${'01'.repeat(32)}` })).toThrow('invalid_recovery_policy')
    expect(cloudConfig({ ...env, MINING_EXPIRED_RECOVERY_HASH: '0x0fb7c2a1a0a532e8531744e408a31422b2e0c43a93ed8847e7eec3a46707c3a5' }).config.expiredRecoveryHash).toBe('0x0fb7c2a1a0a532e8531744e408a31422b2e0c43a93ed8847e7eec3a46707c3a5')
    const c = fixture().c
    expect(validateConfig(c).expectedSigner).toBe(TEST_SIGNER)
    expect(() => validateConfig({ ...c, chainId: 196 as 1952 })).toThrow('invalid_1952_config')
    expect(() => validateConfig({ ...c, rpcUrl: 'https://rpc.ignix.bot/rpc/196' })).toThrow('invalid_1952_config')
    expect(() => validateConfig({ ...c, expectedSigner: wallet.address })).toThrow('invalid_1952_config')
    expect(() => validateConfig({ ...c, keeperAddress: TEST_SIGNER })).toThrow('invalid_keeper')
    const loopback = { ...c, publicOrigin: 'http://127.0.0.1:5173', rpcUrl: 'http://127.0.0.1:8955/', expectedSigner: wallet.address }
    expect(validateConfig(loopback, true).expectedSigner).toBe(wallet.address)
    expect(() => validateConfig(loopback)).toThrow('invalid_1952_config')
    expect(() => validateConfig({ ...loopback, publicOrigin: 'https://test.example' }, true)).toThrow('invalid_1952_config')
    expect(() => validateConfig({ ...loopback, rpcUrl: 'https://rpc.ignix.bot/rpc/196' }, true)).toThrow('invalid_1952_config')
  })
})
