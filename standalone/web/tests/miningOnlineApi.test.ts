import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeFunctionData, parseAbi } from 'viem'
import * as calls from '../../mining-calls'
import { createLaunchChallenge, launchAuthenticationMessage, loadOnlineCatalog, loadOnlineStatus, normalizeOnlineLaunchForm,
  parseOnlineCatalog, registerOnlineLaunch, requestOnlineCheck, validateOnlineLaunchTransaction } from '../src/mining/onlineApi'
import { onlineMessages, onlineReason } from '../src/mining/onlineMessages'
import { miningTestAddress, miningTestDeployment, MINING_TEST_ACCOUNT, MINING_TEST_HASH } from './fixtures/miningProducts'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
const form = { name: 'TEST New miner', symbol: 'TEST-NEW', metadataURI: '' }
const envelope = (extra: Record<string, unknown>): Record<string, unknown> => ({ schemaVersion: 1, chainId: 1952, deploymentVersion: 'fixture-v2', ...extra })
const project = (): ReturnType<typeof miningTestDeployment>['projects'][number] => {
  const p = miningTestDeployment().projects[0]
  return { symbol: 'TEST-NEW', token: { ...p.token, address: miningTestAddress(401) }, vault: { ...p.vault, address: miningTestAddress(402) }, holder: { ...p.holder, address: miningTestAddress(403) } }
}
describe('mining online API boundaries', () => {
  it('normalizes only presentation fields and rejects message injection or unsafe links', () => {
    expect(normalizeOnlineLaunchForm({ name: '  New miner  ', symbol: 'new', metadataURI: ' ipfs://cid/path ' })).toEqual({ ...form, metadataURI: 'ipfs://cid/path' })
    for (const value of [{ ...form, name: 'miner\nOrigin: evil' }, { ...form, name: '\tminer' }, { ...form, name: '矿'.repeat(22) },
      { ...form, symbol: 'TEST-NEW<>' }, { ...form, metadataURI: 'javascript:alert(1)' }, { ...form, metadataURI: 'http://example.com/' }]) {
      expect(() => normalizeOnlineLaunchForm(value)).toThrow('onlineInvalidForm')
    }
  })
  it('merges projects and graduated pairs while retaining base contracts and journal version', async () => {
    const d = miningTestDeployment(), next = project(), fetch = vi.fn(async () => Response.json(envelope({ revision: 'rev-2', projects: [next], version: 'attacker', contracts: {} })))
    vi.stubGlobal('fetch', fetch)
    const catalog = await loadOnlineCatalog(d, next.token.address)
    expect(catalog.deployment.version).toBe(d.version)
    expect(catalog.deployment.contracts).toBe(d.contracts)
    expect(catalog.deployment.projects.map((p) => p.symbol)).toEqual(['TEST-A', 'TEST-NEW'])
    expect(fetch.mock.calls[0]).toBeDefined()
    const graduated = { ...next, pair: { ...next.token, address: miningTestAddress(404) } }
    const updated = parseOnlineCatalog(catalog.deployment, [graduated], 'rev-3')
    expect(updated.deployment.projects[1].pair?.address).toBe(graduated.pair.address)
    expect(parseOnlineCatalog(updated.deployment, [next], 'rev-4').deployment.projects[1].pair?.address).toBe(graduated.pair.address)
  })
  it('rejects directory rebindings, collisions and invalid network envelopes', async () => {
    const d = miningTestDeployment(), p = d.projects[0]
    expect(() => parseOnlineCatalog(d, [{ ...p, vault: { ...p.vault, address: miningTestAddress(999) } }], 'rev-2')).toThrow('onlineInvalidResponse')
    expect(() => parseOnlineCatalog(d, [{ ...project(), token: { ...p.token, address: d.contracts.fab.address } }], 'rev-2')).toThrow('onlineInvalidResponse')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...envelope({ revision: 'a', projects: [] }), chainId: 196 })))
    await expect(loadOnlineCatalog(d)).rejects.toThrow('onlineInvalidResponse')
  })
  it('does not retain unexpected project identity fields', () => {
    const p = project(), parsed = parseOnlineCatalog(miningTestDeployment(), [{ ...p, token: { ...p.token, implementation: 'untrusted' }, contractOverrides: {} }], 'rev-2')
    expect(parsed.deployment.projects[1]).toEqual(p)
  })
  it('checks a complete, origin-bound authentication message before requesting a signature', async () => {
    const d = miningTestDeployment(), requestId = crypto.randomUUID(), expiresAt = Math.floor(Date.now() / 1000) + 120
    const message = launchAuthenticationMessage(d, MINING_TEST_ACCOUNT, requestId, expiresAt, form)
    const fetch = vi.fn(async () => Response.json(envelope({ requestId, expiresAt, form, message })))
    vi.stubGlobal('fetch', fetch)
    expect((await createLaunchChallenge(d, MINING_TEST_ACCOUNT, requestId, form)).message).toContain(`Origin: ${location.origin}`)
    const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/mining/challenge')
    expect(options.headers).toMatchObject({ 'X-SodaDEX-Network-Profile': '1952-mining-test', 'Content-Type': 'application/json' })
    expect(JSON.parse(String(options.body))).toEqual({ address: MINING_TEST_ACCOUNT, action: 'launch', requestId, form })
    fetch.mockImplementation(async () => Response.json(envelope({ requestId, expiresAt, form, message: message.replace(location.origin, 'https://evil.test') })))
    await expect(createLaunchChallenge(d, MINING_TEST_ACCOUNT, requestId, form)).rejects.toThrow('onlineInvalidResponse')
  })
  it('rejects altered fields and expired challenge responses', async () => {
    const d = miningTestDeployment(), requestId = crypto.randomUUID(), expiresAt = Math.floor(Date.now() / 1000) - 1
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(envelope({ requestId, expiresAt, form, message: 'expired' }))))
    await expect(createLaunchChallenge(d, MINING_TEST_ACCOUNT, requestId, form)).rejects.toThrow('onlineExpired')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(envelope({ requestId, expiresAt: expiresAt + 120, form: { ...form, symbol: 'TEST-OTHER' }, message: 'changed' }))))
    await expect(createLaunchChallenge(d, MINING_TEST_ACCOUNT, requestId, form)).rejects.toThrow('onlineInvalidResponse')
  })
  it('requires shared call admission plus exact form, sender, destination, value and expiry', () => {
    const d = miningTestDeployment(), expiry = Math.floor(Date.now() / 1000) + 120
    // This test isolates the browser binding check. The shared financial-policy validator is tested separately.
    const abi = parseAbi(['function createToken((string name,string symbol,string metadataURI) p,uint16 templateId,bytes vaultData,uint64 deadline)'])
    const guard = vi.spyOn(calls, 'validMiningProductCall').mockReturnValue(true)
    vi.spyOn(calls, 'miningAbi').mockReturnValue(abi)
    const tx = { from: MINING_TEST_ACCOUNT, to: d.contracts.manager.address,
      data: encodeFunctionData({ abi, functionName: 'createToken', args: [form, 1, '0x', BigInt(expiry)] }), value: '0x0' as const }
    expect(validateOnlineLaunchTransaction(d, MINING_TEST_ACCOUNT, form, tx, expiry)).toEqual(tx)
    for (const changed of [{ ...tx, from: miningTestAddress(999) }, { ...tx, to: miningTestAddress(998) }, { ...tx, value: '0x1' }]) {
      expect(() => validateOnlineLaunchTransaction(d, MINING_TEST_ACCOUNT, form, changed, expiry)).toThrow('onlineInvalidResponse')
    }
    expect(() => validateOnlineLaunchTransaction(d, MINING_TEST_ACCOUNT, { ...form, name: 'TEST Changed' }, tx, expiry)).toThrow('onlineInvalidResponse')
    expect(() => validateOnlineLaunchTransaction(d, MINING_TEST_ACCOUNT, form, tx, expiry + 1)).toThrow('onlineInvalidResponse')
    guard.mockReturnValue(false)
    expect(() => validateOnlineLaunchTransaction(d, MINING_TEST_ACCOUNT, form, tx, expiry)).toThrow('onlineInvalidResponse')
  })
  it('keeps budget and job history readable when reorg reserves exceed the cap, rejecting invalid hashes', async () => {
    const d = miningTestDeployment(), status = { admissionEnabled: true, executionEnabled: true, signer: MINING_TEST_ACCOUNT, keeper: miningTestAddress(901),
      budget: { capWei: '100', spentWei: '30', reservedWei: '20' }, farm: { capacity: 10, minerCount: 1, procurementBudgetFab: '100000000' },
      jobs: [{ id: 'job-1', kind: 'purchase', status: 'submitted', reason: '', hash: MINING_TEST_HASH, updatedAt: Date.now() }] }
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(envelope(status))))
    expect((await loadOnlineStatus(d)).jobs[0].hash).toBe(MINING_TEST_HASH)
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(envelope({ ...status, budget: { ...status.budget, reservedWei: '100' } }))))
    expect((await loadOnlineStatus(d)).budget.reservedWei).toBe('100')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(envelope({ ...status, jobs: [{ ...status.jobs[0], hash: 'bad' }] }))))
    await expect(loadOnlineStatus(d)).rejects.toThrow('onlineInvalidResponse')
  })
  it('registration only posts the receipt hash and never resends a transaction', async () => {
    const p = project(), fetch = vi.fn(async () => Response.json(envelope({ project: p, revision: 'registered-1' })))
    vi.stubGlobal('fetch', fetch)
    expect(await registerOnlineLaunch(miningTestDeployment(), MINING_TEST_HASH)).toEqual({ project: p, revision: 'registered-1' })
    const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/mining/register')
    expect(JSON.parse(String(options.body))).toEqual({ transactionHash: MINING_TEST_HASH })
  })
  it('never automatically retries a failed POST or displays raw service diagnostics', async () => {
    const fetch = vi.fn(async () => Response.json({ error: 'secret diagnostic' }, { status: 503 }))
    vi.stubGlobal('fetch', fetch)
    await expect(requestOnlineCheck(miningTestDeployment())).rejects.toThrow('onlineServiceUnavailable')
    expect(fetch).toHaveBeenCalledTimes(1)
    for (const locale of ['zh-CN', 'en', 'yue-HK'] as const) {
      const m = onlineMessages(locale)
      expect(onlineReason('secret diagnostic', m)).toBe(m.reasonOther)
      expect(onlineReason('gas_budget', m)).toBe(m.reasonBudget)
      for (const reason of ['farm_full','no_approved_inventory','procurement_budget_exhausted','not_graduated','no_tax','settled','pending_confirmation','broadcast_unknown','nonce_cancellation_pending','nonce_cancellation_broadcast_unknown','authorization_cancelled']) expect(onlineReason(reason,m)).not.toBe(m.reasonOther)
    }
  })
  it('lets the user retry bounded history checks without authenticating or retrying the POST automatically', async () => {
    const fetch = vi.fn(async () => Response.json({ schemaVersion: 1, chainId: 1952, error: 'expiry_reconciliation_pending' }, { status: 503 }))
    vi.stubGlobal('fetch', fetch)
    await expect(createLaunchChallenge(miningTestDeployment(), MINING_TEST_ACCOUNT, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', form)).rejects.toThrow('onlineHistoryChecking')
    expect(fetch).toHaveBeenCalledTimes(1)
    fetch.mockImplementation(async () => Response.json({ schemaVersion: 1, chainId: 196, error: 'expiry_reconciliation_pending' }, { status: 503 }))
    await expect(createLaunchChallenge(miningTestDeployment(), MINING_TEST_ACCOUNT, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', form)).rejects.toThrow('onlineServiceUnavailable')
  })
})
