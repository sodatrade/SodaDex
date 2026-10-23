// Owned local fork only. Never loads keys, signs locally, or broadcasts to a public RPC.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../web/package.json', import.meta.url))
const { createPublicClient, http, encodeDeployData, encodeFunctionData, parseAbi, toHex, keccak256 } = require('viem')
const endpoint = 'http://127.0.0.1:61926', expectedPid = process.argv[2]
if (!/^\d+$/.test(expectedPid ?? '') || execFileSync('lsof', ['-nP', '-iTCP@127.0.0.1:61926', '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim() !== expectedPid) throw Error('Owned fork PID required')
const c = createPublicClient({ transport: http(endpoint, { retryCount: 0, timeout: 120000 }) })
if (await c.getChainId() !== 196 || !String(await c.request({ method: 'web3_clientVersion' })).toLowerCase().includes('anvil')) throw Error('Local Anvil only')
const root = process.cwd(), contractRoot = path.resolve(root, '../../XTruthWorkspace/contract')
const owner = '0x6ecf746b078d46391f8C425B150153212F7C0545', recipient = '0x6EFa1Fad18900B929Fe6782fd3eaBeac2563416A'
const vault = '0xb97d23f0c874fc1380016fa31d975d7ccd13b94d', fab = '0x842b7bf61f2cb4be8aacac6adece3244c2a6f6ab'
const readArtifact = name => JSON.parse(fs.readFileSync(`${contractRoot}/out/${name}.sol/${name}.json`))
const poolArtifact = readArtifact('SodaIgnixPool'), lockerArtifact = readArtifact('SodaLocker'), incomeArtifact = readArtifact('IgnixTreasuryIncome')
const tokenAbi = parseAbi(['function approve(address,uint256) returns(bool)', 'function transfer(address,uint256) returns(bool)', 'function balanceOf(address) view returns(uint256)'])
const start = await c.getBlock(), nonce = await c.getTransactionCount({ address: owner }), rows = []
// Anvil's default priority fee differs from X Layer. Use the public read-only
// gas quote; every transaction below still targets the owned local fork.
const publicRead = createPublicClient({ transport: http('https://rpc.ignix.bot/rpc/196', { retryCount: 0 }) })
const gasPrice = await publicRead.getGasPrice()
if (gasPrice > 30_000_000n) throw Error('Gas price exceeds proposed ceiling')
const read = (address, abi, functionName, args = []) => c.readContract({ address, abi, functionName, args })
async function send(label, data, to, value = 0n) {
  // Mining income appears in the next block; estimate the paid-harvest branch,
  // not the zero-income branch immediately following the previous checkpoint.
  await c.request({ method: 'evm_increaseTime', params: [2] })
  await c.request({ method: 'evm_mine', params: [] })
  const tx = { account: owner, data, ...(to ? { to } : {}), value }
  const estimate = await c.estimateGas(tx), padded = (estimate * 120n + 99n) / 100n
  const settlesMining = ['first-liquidity', 'increase-liquidity', 'buy-shares', 'sell-shares', 'remove-half', 'record-pool-fab', 'lock-remaining-lp'].includes(label)
  const limit = settlesMining && padded < 1200000n ? 1200000n : padded
  const hash = await c.request({ method: 'eth_sendTransaction', params: [{ from: owner, data, ...(to ? { to } : {}), value: toHex(value), gas: toHex(limit), gasPrice: toHex(gasPrice) }] })
  const receipt = await c.waitForTransactionReceipt({ hash, checkReplacement: false })
  if (receipt.status !== 'success') throw Error(label + ' reverted')
  rows.push({ label, to: to ?? null, value, data, gasUsed: receipt.gasUsed, plannedGasLimit: limit, localHash: hash, createdAddress: receipt.contractAddress })
  return receipt.contractAddress
}
const call = (label, address, abi, functionName, args = [], value = 0n) => send(label, encodeFunctionData({ abi, functionName, args }), address, value)
const pool = await send('deploy-new-special-pool', encodeDeployData({ abi: poolArtifact.abi, bytecode: poolArtifact.bytecode.object, args: [vault, recipient] }))
const income = await read(pool, poolArtifact.abi, 'INCOME'), rewards = await read(pool, poolArtifact.abi, 'REWARDS')
if ((await read(income, incomeArtifact.abi, 'RECIPIENT')).toLowerCase() !== recipient.toLowerCase()) throw Error('Treasury mismatch')
const locker = await send('deploy-new-locker', encodeDeployData({ abi: lockerArtifact.abi, bytecode: lockerArtifact.bytecode.object, args: [pool, owner] }))
const deadline = (await c.getBlock()).timestamp + 900n
await call('approve-shares', vault, tokenAbi, 'approve', [pool, 110n * 10n ** 18n + 10n ** 16n])
await call('first-liquidity', pool, poolArtifact.abi, 'addLiquidity', [100n * 10n ** 18n, 1n, 30_000_000_000n, deadline], 30_000_000_000n)
await call('increase-liquidity', pool, poolArtifact.abi, 'addLiquidity', [10n * 10n ** 18n, 1n, 3_000_000_000n, deadline], 3_000_000_000n)
await call('buy-shares', pool, poolArtifact.abi, 'swap', [false, 10_000_000n, 1n, deadline], 10_000_000n)
await call('sell-shares', pool, poolArtifact.abi, 'swap', [true, 10n ** 16n, 1n, deadline])
const lpBefore = await read(pool, tokenAbi, 'balanceOf', [owner])
await call('remove-half', pool, poolArtifact.abi, 'removeLiquidity', [lpBefore / 2n, 1n, 1n, deadline])
// Deterministic TEST-FAB income in addition to any actual mining reward on the fork.
await call('donate-test-fab-to-pool', fab, tokenAbi, 'transfer', [pool, 10000n])
await call('record-pool-fab', pool, poolArtifact.abi, 'harvest')
const okbOwed = await read(income, incomeArtifact.abi, 'platformOkbOwed'), fabOwed = await read(income, incomeArtifact.abi, 'lpFabOwed')
const beforeOkb = await c.getBalance({ address: recipient }), beforeFab = await read(fab, tokenAbi, 'balanceOf', [recipient])
await call('pay-platform-okb', income, incomeArtifact.abi, 'claimPlatformOkb')
await call('pay-lp-fab', income, incomeArtifact.abi, 'claimLpFab')
if (okbOwed <= 0n || fabOwed < 10000n || (await c.getBalance({ address: recipient })) - beforeOkb !== okbOwed || (await read(fab, tokenAbi, 'balanceOf', [recipient])) - beforeFab !== fabOwed) throw Error('Treasury payout mismatch')
const lpLeft = await read(pool, tokenAbi, 'balanceOf', [owner])
await call('approve-locker', pool, tokenAbi, 'approve', [locker, lpLeft])
await call('lock-remaining-lp', locker, lockerArtifact.abi, 'lock', [lpLeft])
if (await read(pool, tokenAbi, 'balanceOf', [owner]) !== 0n || await read(locker, lockerArtifact.abi, 'locked') !== lpLeft) throw Error('Lock mismatch')
const maxGas = rows.reduce((sum, row) => sum + row.plannedGasLimit, 0n) * 30_000_000n, actualGas = rows.reduce((sum, row) => sum + row.gasUsed, 0n)
const result = { localOnly: true, productionTouched: false, chainId: 196, owner, recipient, block: start.number, nonce,
  addressesAreLocalPredictions: true, pool, income, rewards, locker, poolCreationHash: keccak256(poolArtifact.bytecode.object),
  transactions: rows.length, gasUnits: actualGas, gasPriceWei: gasPrice, gasCapAt003Gwei: maxGas, nativeInputWei: 33_010_000_000n, testFabInputRaw: 10000n,
  treasuryOkbPaid: okbOwed, treasuryFabPaid: fabOwed, remainingLpLocked: lpLeft, rows }
const output = path.join(root, 'deployments/xlayer-196-fragments-test/ignix-income', process.argv.includes('--final') ? 'final-rehearsal.json' : 'rehearsal.json')
if (fs.existsSync(output)) throw Error('Keep existing rehearsal')
fs.writeFileSync(output, JSON.stringify(result, (_, v) => typeof v === 'bigint' ? String(v) : v, 2) + '\n')
console.log(JSON.stringify({ localOnly: true, transactions: rows.length, gasUnits: String(actualGas), gasCapWei: String(maxGas), nativeInputWei: result.nativeInputWei.toString() }))
