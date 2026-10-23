// Recovery is intentionally limited to the four confirmed CREATEs before upgrade.
// Never skip arbitrary historical business transactions or relax their invariants.
import { getCreateAddress, keccak256 } from 'viem'
import { VerifiedMiningRpc } from './mining-public-rpc.mjs'

const NAMES = ['FabxRewardHistory', 'DewebRewardAccounting', 'DewebMiningExtension', 'PodMining']
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function recoveringMiningRpc(owner, { fetcher = fetch, now = Date.now, sleep = delay, windowMs = 120_000 } = {}) {
  return { async request(method, params = []) {
    const deadline = now() + windowMs
    const client = new VerifiedMiningRpc(owner, (url, options) => {
      const remaining = deadline - now()
      if (remaining <= 0) throw new Error('Recovery read window expired')
      return fetcher(url, { ...options, signal: AbortSignal.timeout(Math.min(20_000, remaining)) })
    })
    for (;;) {
      try { return await client.request(method, params) }
      catch (error) {
        const message = error instanceof Error ? error.message : ''
        const transient = /pending snapshot stayed stale|RPC transport failed|fetch failed|timed out|timeout/i.test(message)
        if (method === 'eth_sendRawTransaction' || !transient || now() >= deadline) throw error
        await sleep(Math.min(2000, deadline - now()))
      }
    }
  } }
}

export function validateFourCreateJournal(journal, rehearsal, policy) {
  if (journal.chainId !== 1952 || journal.publicTestnet !== true || journal.productionTouched !== false ||
    journal.startNonce !== '16' || journal.pending || journal.stack || journal.miners || journal.business ||
    !same(journal.owner, rehearsal.owner) || journal.feeCap !== rehearsal.feeCap || journal.transactions?.length !== 4 ||
    !rehearsal.localForkOnly || rehearsal.broadcast !== false || rehearsal.chainId !== 1952 || rehearsal.startNonce !== '16' ||
    rehearsal.transactions?.length !== 102 || rehearsal.business?.completed !== true || rehearsal.budgetPassed !== true ||
    rehearsal.transactions.some((r) => r.status !== '0x1') || policy.chainId !== 1952)
    throw new Error('Recovery requires exactly the confirmed four-CREATE boundary')
  const names = Object.keys(journal.contracts ?? {})
  if (names.length !== 4 || names.some((n) => !NAMES.includes(n))) throw new Error('Recovery contract prefix changed')
  let actualFees = 0n
  for (const [i, name] of NAMES.entries()) {
    const row = journal.transactions[i], expected = rehearsal.transactions[i], identity = journal.contracts[name]
    const created = getCreateAddress({ from: journal.owner, nonce: 16n + BigInt(i) })
    if (row.label !== `Deploy ${name}` || row.label !== expected.label || row.nonce !== String(16 + i) ||
      row.to !== null || row.value !== '0' || expected.to !== null || expected.value !== '0' || row.status !== '0x1' ||
      row.costStatus !== 'known' || !same(row.created, created) || !same(expected.created, created) ||
      !same(row.dataKeccak256, keccak256(expected.data)) || !same(identity.address, created) ||
      identity.runtimeKeccak256 !== rehearsal.contracts[name]?.runtimeKeccak256 ||
      !/^0x[0-9a-f]{64}$/i.test(row.hash) || BigInt(row.feeWei) <= 0n)
      throw new Error('Confirmed CREATE differs from the original rehearsal')
    actualFees += BigInt(row.feeWei)
  }
  const remaining = rehearsal.transactions.slice(4).reduce((sum, r) => sum + BigInt(r.gas) * BigInt(journal.feeCap), 0n)
  if (actualFees !== BigInt(journal.actualFeesWei) || actualFees + remaining > BigInt(policy.phaseBudget.gasWei))
    throw new Error('Recovery exceeds the original cumulative phase budget')
  return { actualFees, reservedPhaseWei: actualFees + remaining }
}

export async function verifyFourCreateCheckpoint(plan, journal, rehearsal, policy) {
  const fees = validateFourCreateJournal(journal, rehearsal, policy)
  if (await plan.rpc('eth_chainId') !== '0x7a0' ||
    BigInt(await plan.rpc('eth_getTransactionCount', [journal.owner, 'latest'])) !== 20n ||
    BigInt(await plan.rpc('eth_getTransactionCount', [journal.owner, 'pending'])) !== 20n)
    throw new Error('Recovery nonce or network changed')
  for (const [i, row] of journal.transactions.entries()) {
    const receipt = await plan.rpc('eth_getTransactionReceipt', [row.hash])
    const block = await plan.rpc('eth_getBlockByNumber', [row.blockNumber, true])
    const transaction = block?.transactions?.find((tx) => same(tx.hash, row.hash))
    const extra = BigInt(receipt?.l1Fee ?? '0x0') + BigInt(receipt?.operatorFee ?? '0x0')
    if (!receipt || receipt.status !== '0x1' || !same(receipt.from, journal.owner) || receipt.to !== null ||
      !same(receipt.transactionHash, row.hash) || !same(receipt.contractAddress, row.created) ||
      receipt.blockHash !== row.blockHash || block.hash !== row.blockHash || receipt.blockNumber !== row.blockNumber ||
      BigInt(receipt.gasUsed) !== BigInt(row.gasUsed) || BigInt(receipt.gasUsed) > BigInt(row.gas) ||
      BigInt(receipt.effectiveGasPrice) !== BigInt(journal.feeCap) || extra !== 0n ||
      BigInt(receipt.operatorFeeScalar ?? '0x0') !== 0n || BigInt(receipt.operatorFeeConstant ?? '0x0') !== 0n ||
      BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice) !== BigInt(row.feeWei) ||
      BigInt(await plan.rpc('eth_blockNumber')) < BigInt(row.blockNumber) + 1n || !transaction ||
      !same(transaction.from, journal.owner) || transaction.to !== null || BigInt(transaction.chainId) !== 1952n ||
      BigInt(transaction.nonce) !== BigInt(row.nonce) || BigInt(transaction.value) !== 0n ||
      BigInt(transaction.gas) !== BigInt(row.gas) || BigInt(transaction.gasPrice) !== BigInt(journal.feeCap) ||
      !same(keccak256(transaction.input), row.dataKeccak256))
      throw new Error('Confirmed recovery receipt or fees changed')
    const identity = journal.contracts[NAMES[i]], code = await plan.rpc('eth_getCode', [identity.address, 'latest'])
    if (keccak256(code) !== identity.runtimeKeccak256) throw new Error('Confirmed recovery runtime changed')
  }
  await plan.checkFeeModel(0n, 0n)
  return fees
}

export function installFourCreateReuse(plan, rehearsal, journal) {
  let consumed = 0
  const deploy = plan.deploy.bind(plan), send = plan.send.bind(plan)
  plan.send = async (...args) => {
    if (consumed !== 4) throw new Error('Recovery cannot send before reusing the exact four CREATEs')
    return send(...args)
  }
  plan.deploy = async (name, bytecode) => {
    if (consumed === 4) return deploy(name, bytecode)
    const row = rehearsal.transactions[consumed], confirmed = journal.transactions[consumed]
    if (name !== NAMES[consumed] || row.label !== `Deploy ${name}` || !same(row.data, bytecode) ||
      !same(keccak256(bytecode), confirmed.dataKeccak256)) throw new Error('Recovery creation bytecode or order changed')
    consumed++
    return confirmed.created
  }
  return () => consumed === 4
}
