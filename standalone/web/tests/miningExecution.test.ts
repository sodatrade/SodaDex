import { describe, expect, it, vi } from 'vitest'
import { executeMiningCall, type MiningExecution } from '../src/mining/execution'
import { miningData } from '../src/mining/protocol'
import { loadMiningJournal, saveMiningSubmission, type MiningSubmission } from '../src/mining/journal'
import { validMiningProductCall } from '../../mining-calls'
import { miningTestAddress, miningTestDeployment, miningTestRpc, MINING_TEST_ACCOUNT, MINING_TEST_HASH } from './fixtures/miningProducts'

function fixture(): { c: MiningExecution; request: ReturnType<typeof vi.fn>; submitted: MiningSubmission[] } {
  const d = miningTestDeployment(), submitted: MiningSubmission[] = []
  const request = vi.fn(async ({ method }: { method: string }) => method === 'eth_chainId' ? '0x7a0' : method === 'eth_accounts' ? [MINING_TEST_ACCOUNT] : MINING_TEST_HASH)
  const identity = { provider: { request }, chainId: 1952, address: MINING_TEST_ACCOUNT, revision: 1 }
  return { request, submitted, c: { deployment: d, identity, getIdentity: () => identity, isCurrent: () => true, read: miningTestRpc(d),
    onStage: vi.fn(), onSubmission: (item) => submitted.push({ ...item }), wait: async () => 'success' } }
}
describe('1952 wallet execution and recoverable hashes', () => {
  it('simulates and verifies before the exact wallet call, and persists a confirming hash', async () => {
    const { c, request, submitted } = fixture()
    const tx = { from: MINING_TEST_ACCOUNT, to: c.deployment.contracts.fragmentVault.address, value: '0x0' as const, data: miningData('fragmentVault', 'claim') }
    await executeMiningCall(c, tx, 'claim')
    expect(request.mock.calls.at(-1)?.[0]).toMatchObject({ method: 'eth_sendTransaction', params: [{ ...tx, chainId: '0x7a0', gas: '0x13334', gasPrice: '0x1' }] })
    expect(submitted.map((r) => r.status)).toEqual(['pending', 'success'])
  })
  it('stops a stale wallet before submission, including when events were omitted', async () => {
    const { c, request } = fixture()
    request.mockImplementation(async ({ method }) => method === 'eth_chainId' ? '0xc4' : [MINING_TEST_ACCOUNT])
    await expect(executeMiningCall(c, { from: MINING_TEST_ACCOUNT, to: c.deployment.contracts.fragmentVault.address, value: '0x0', data: miningData('fragmentVault', 'claim') }, 'claim')).rejects.toThrow('miningIdentityChanged')
    expect(request.mock.calls.some(([r]) => r.method === 'eth_sendTransaction')).toBe(false)
  })
  it('does not open a wallet transaction when pending simulation times out', async () => {
    const { c, request, submitted } = fixture(), read = c.read
    c.read = async (method, params) => {
      if (method === 'eth_call' && params?.includes('pending')) throw new DOMException('Timed out', 'TimeoutError')
      return read(method, params)
    }
    await expect(executeMiningCall(c, { from: MINING_TEST_ACCOUNT, to: c.deployment.contracts.fragmentVault.address,
      value: '0x0', data: miningData('fragmentVault', 'claim') }, 'claim')).rejects.toThrow('Timed out')
    expect(request.mock.calls.some(([r]) => r.method === 'eth_sendTransaction')).toBe(false)
    expect(submitted).toHaveLength(0)
  })
  it('keeps the hash if the wallet changes during approval and prevents the next step', async () => {
    const { c, request, submitted } = fixture()
    let current = c.identity
    c.getIdentity = () => current
    request.mockImplementation(async ({ method }) => {
      if (method === 'eth_sendTransaction') { current = { ...current, revision: 2 }; return MINING_TEST_HASH }
      return method === 'eth_chainId' ? '0x7a0' : [MINING_TEST_ACCOUNT]
    })
    await expect(executeMiningCall(c, { from: MINING_TEST_ACCOUNT, to: c.deployment.contracts.fab.address, value: '0x0',
      data: miningData('token', 'approve', [c.deployment.contracts.fragmentPool.address, 100n]) }, 'fragmentBuy', true)).rejects.toThrow('miningIdentityChanged')
    expect(submitted[0].hash).toBe(MINING_TEST_HASH)
  })
  it('does not resend a pending transaction and separates records by deployment version', async () => {
    const { c, request, submitted } = fixture()
    c.wait = async () => 'pending'
    await expect(executeMiningCall(c, { from: MINING_TEST_ACCOUNT, to: c.deployment.contracts.fragmentVault.address, value: '0x0', data: miningData('fragmentVault', 'claim') }, 'claim')).rejects.toThrow('miningPending')
    expect(request.mock.calls.filter(([r]) => r.method === 'eth_sendTransaction')).toHaveLength(1)
    const store = new Map<string, string>(), storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) } }
    saveMiningSubmission(c.deployment, submitted[0], storage)
    expect(loadMiningJournal(c.deployment, storage)).toHaveLength(1)
    expect(loadMiningJournal({ ...c.deployment, version: 'other-version' }, storage)).toHaveLength(0)
  })
  it('keeps new-project history before its directory reloads without authorizing calls to unverified targets', () => {
    const base = miningTestDeployment(), token = { ...base.projects[0].token, address: miningTestAddress(701) }
    const live = { ...base, projects: [...base.projects, { ...base.projects[0], token }] }
    const store = new Map<string, string>(), storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) } }
    const entry: MiningSubmission = { hash: MINING_TEST_HASH, from: MINING_TEST_ACCOUNT, to: token.address, action: 'projectSell', at: Date.now(), status: 'pending' }
    saveMiningSubmission(live, entry, storage)
    expect(loadMiningJournal(base, storage)).toEqual([entry])
    saveMiningSubmission(base, { ...entry, hash: `0x${'22'.repeat(32)}`, to: base.contracts.fragmentVault.address, action: 'claim' }, storage)
    expect(loadMiningJournal(live, storage)).toHaveLength(2)
    expect(validMiningProductCall({ from: entry.from, to: token.address, value: '0x0', data: miningData('token', 'approve', [base.contracts.router.address, 1n]) }, base, true)).toBe(false)
  })
  it('treats a wallet transport rejection after submission as unknown, distinct from 4001', async () => {
    const { c, request, submitted } = fixture()
    request.mockImplementation(async ({ method }) => {
      if (method === 'eth_sendTransaction') throw new Error('Transport disconnected after broadcasting')
      return method === 'eth_chainId' ? '0x7a0' : [MINING_TEST_ACCOUNT]
    })
    const tx = { from: MINING_TEST_ACCOUNT, to: c.deployment.contracts.fragmentVault.address, value: '0x0' as const, data: miningData('fragmentVault', 'claim') }
    await expect(executeMiningCall(c, tx, 'claim')).rejects.toThrow('miningSubmissionUnknown')
    expect(request.mock.calls.filter(([r]) => r.method === 'eth_sendTransaction')).toHaveLength(1)
    expect(submitted).toHaveLength(0)
    request.mockImplementation(async ({ method }) => {
      if (method === 'eth_sendTransaction') throw { code: 4001 }
      return method === 'eth_chainId' ? '0x7a0' : [MINING_TEST_ACCOUNT]
    })
    await expect(executeMiningCall(c, tx, 'claim')).rejects.toThrow('miningRejected')
  })
})
