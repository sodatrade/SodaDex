import { describe, expect, it, vi } from 'vitest'
import { normalizeMiningLaunchForm } from '../../mining-signed-calls.ts'
import { Admission } from '../src/admission.ts'
import { Directory } from '../src/directory.ts'
import { handleRequest } from '../src/http.ts'
import { Repository } from '../src/repository.ts'
import { authority, d, fixture, now, signer, wallet } from './fixture.ts'

const mainOrigin = 'https://sodadex-preview.jsmsdx2025.workers.dev'
const legacyOrigin = 'https://sodadex-mining-test-1952.jsmsdx2025.workers.dev'
const requestId = '11111111-1111-4111-8111-111111111111'
const form = { name: 'Origin test', symbol: 'ORIGIN', metadataURI: '' }
const request = (origin: string, path: string, body?: unknown, headers?: Record<string, string>): Request => new Request(`https://internal${path}`, {
  method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body),
  headers: { Origin: origin, 'X-SodaDEX-Network-Profile': '1952-mining-test', 'content-type': 'application/json', ...headers },
})
function setup() {
  const f = fixture(), sign = vi.fn(signer.signMessage)
  f.c.expectedSigner = authority.address; f.rpc.set('signer', authority.address)
  f.c.additionalPublicOrigins = [mainOrigin]
  const app = { config: f.c, d, repo: f.repo,
    admission: new Admission(f.c, d, f.repo, f.rpc, f.discovery, { ...signer, signMessage: sign }, () => now),
    directory: new Directory(f.c, d, f.repo, f.rpc, f.discovery) }
  const challengeBody = { address: wallet.address, action: 'launch', requestId, form }
  return { ...f, app, sign, request, challengeBody }
}
describe('frontend origins share one 1952 ledger but cannot replay launch signatures across sites', () => {
  it.each([legacyOrigin, mainOrigin])('binds the challenge and launch to the actual allowed origin %s', async origin => {
    const f = setup()
    const response = await handleRequest(f.request(origin, '/v1/challenge', f.challengeBody), f.app)
    expect(response.status).toBe(200)
    const challenge = await response.json() as { message: string }
    expect(challenge.message).toContain(`\nOrigin: ${origin}\nChain ID: 1952\n`)
    const signature = await wallet.signMessage({ message: challenge.message })
    const launch = await handleRequest(f.request(origin, '/v1/launch', { requestId, address: wallet.address, signature }), f.app)
    expect(launch.status).toBe(200)
    expect(await launch.json()).toMatchObject({ chainId: 1952, requestId, tx: { from: wallet.address, to: d.contracts.manager.address, value: '0x0' } })
    expect(f.sign).toHaveBeenCalledTimes(1)
  })
  it.each([[legacyOrigin, mainOrigin], [mainOrigin, legacyOrigin]])('rejects challenge and cached authorization replay from %s at %s', async (origin, otherOrigin) => {
    const f = setup()
    const response = await handleRequest(f.request(origin, '/v1/challenge', f.challengeBody), f.app)
    const challenge = await response.json() as { message: string }
    const signature = await wallet.signMessage({ message: challenge.message })
    const launchBody = { requestId, address: wallet.address, signature }
    expect((await handleRequest(f.request(otherOrigin, '/v1/challenge', f.challengeBody), f.app)).status).toBe(403)
    expect((await handleRequest(f.request(otherOrigin, '/v1/launch', launchBody), f.app)).status).toBe(403)
    expect(f.sign).not.toHaveBeenCalled(); expect(f.rpc.calls).toHaveLength(0)
    expect((await handleRequest(f.request(origin, '/v1/launch', launchBody), f.app)).status).toBe(200)
    const saved = f.repo.read()
    expect((await handleRequest(f.request(otherOrigin, '/v1/launch', launchBody), f.app)).status).toBe(403)
    expect(f.repo.read()).toEqual(saved); expect(f.sign).toHaveBeenCalledTimes(1)
  })
  it('preserves schema-1 legacy challenges, authorizations and costs across restart while rejecting changed signed text', async () => {
    const f = setup()
    const legacy = new Admission({ ...f.c, additionalPublicOrigins: undefined }, d, f.repo, f.rpc, f.discovery, signer, () => now)
    const challenge = legacy.challenge(wallet.address, requestId, normalizeMiningLaunchForm(form))
    const signature = await wallet.signMessage({ message: challenge.message })
    const authorization = await legacy.launch(wallet.address, requestId, signature)
    f.repo.change(s => { s.spentWei = '24'; s.reservedWei = '17' }); await f.repo.flush()
    const saved = f.repo.read(), repo = new Repository(f.storage, d)
    const restarted = new Admission(f.c, d, repo, f.rpc, f.discovery, signer, () => now)
    await expect(restarted.launch(wallet.address, requestId, signature, mainOrigin)).rejects.toMatchObject({ code: 'origin_denied', status: 403 })
    expect(await restarted.launch(wallet.address, requestId, signature, legacyOrigin)).toEqual(authorization)
    expect(repo.read()).toEqual(saved); expect(repo.read().schema).toBe(1)
    repo.change(s => { s.challenges[requestId].message += '\nAltered origin metadata' })
    await expect(restarted.launch(wallet.address, requestId, signature, legacyOrigin)).rejects.toMatchObject({ code: 'origin_denied', status: 403 })
  })
  it('accepts snapshots only with an allowlisted actual Origin and the 1952 profile', async () => {
    const f = setup()
    for (const origin of [legacyOrigin, mainOrigin]) expect((await handleRequest(f.request(origin, '/v1/status'), f.app)).status).toBe(200)
    expect((await handleRequest(f.request(mainOrigin, '/v1/status', undefined, { 'X-SodaDEX-Network-Profile': '196-dex-test' }), f.app)).status).toBe(403)
    expect((await handleRequest(f.request('https://attacker.invalid', '/v1/status', undefined, { 'X-Forwarded-Origin': legacyOrigin }), f.app)).status).toBe(403)
    expect((await handleRequest(f.request('', '/v1/status'), f.app)).status).toBe(403)
    expect(f.rpc.calls).toHaveLength(0)
  })
})
