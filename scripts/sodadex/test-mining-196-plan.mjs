import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Mining196Plan, LOCAL_RPC } from './mining-196-plan.mjs'
import { load196Artifacts } from './mining-196-artifacts.mjs'

test('transport cannot be replaced by a public URL and requires its live child', async () => {
  assert.equal(LOCAL_RPC, 'http://127.0.0.1:8956')
  const plan = new Mining196Plan('0x0000000000000000000000000000000000000001', '/tmp/not-written', 1n, { pid: 0, exitCode: null })
  await assert.rejects(plan.rpc('eth_sendTransaction', []), /Owned Anvil/)
})
test('an owned local HTTP process on a wrong chain is refused before any write', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soda196-guard-')), journal = path.join(dir, 'requests')
  const code = `require('node:http').createServer((req,res)=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{const x=JSON.parse(b);require('node:fs').appendFileSync(${JSON.stringify(journal)},x.method+'\\n');res.end(JSON.stringify({jsonrpc:'2.0',id:1,result:'0x7a0'}))})}).listen(8956,'127.0.0.1',()=>process.stdout.write('ready'))`
  const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); child.once('exit', () => reject(new Error('Port unavailable'))) })
    const plan = new Mining196Plan('0x0000000000000000000000000000000000000001', path.join(dir, 'out'), 1n, child)
    await assert.rejects(plan.start(), /196 Anvil required/)
    assert.equal(fs.readFileSync(journal, 'utf8'), 'eth_chainId\n')
    assert.equal(fs.existsSync(path.join(dir, 'out')), false)
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const exited = new Promise((resolve) => child.once('exit', resolve)); child.kill('SIGTERM'); await exited }
    fs.rmSync(dir, { recursive: true })
  }
})
test('196 artifact manifest rejects legacy profile and changed bytecode', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soda196-artifact-'))
  try {
    const file = path.join(dir, 'manifest.json'), artifact = path.join(dir, 'contract.json')
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, chainId: 1952, sourceRoot: dir, artifacts: {} }))
    assert.throws(() => load196Artifacts(file), /196 compilation/)
    fs.writeFileSync(artifact, '{}')
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, chainId: 196, sourceRoot: dir, artifacts: { Test: { file: artifact, sha256: '0'.repeat(64) } } }))
    assert.throws(() => load196Artifacts(file), /artifact changed/)
  } finally { fs.rmSync(dir, { recursive: true }) }
})

test('budget groups count backend once and isolate optional replay', async () => {
  const { summarize196Budget } = await import('./mining-196-budget.mjs')
  const labels = ['Deploy test', 'Mint five test NAND units', 'Bounded test asset approval', 'Seed real TEST FAB/native liquidity', 'Signed farm miner procurement']
  const rows = labels.map((label) => ({ label, gas: '12', gasUsed: '10', l1FeeUpperBoundWei: '2', operatorFeeUpperBoundWei: '3', status: '0x1' }))
  const budget = summarize196Budget(rows, 2n)
  assert.equal(budget.fullPhase.feeUpperBoundWei, '145')
  assert.equal(BigInt(budget.deployment.feeUpperBoundWei) + BigInt(budget.inventory.feeUpperBoundWei) + BigInt(budget.businessAcceptance.feeUpperBoundWei), 145n)
  assert.equal(budget.backendSubsetAlreadyIncluded.feeUpperBoundWei, '29')
  assert.equal(budget.additionalBrowserReplayAllowance.feeUpperBoundWei, '87')
  assert.throws(() => summarize196Budget(rows.map((r, i) => ({ ...r, status: i ? '0x1' : '0x0' })), 2n), /Incomplete/)
})
