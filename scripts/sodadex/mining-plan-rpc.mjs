import fs from 'node:fs'
import { encodeFunctionData, decodeFunctionResult, keccak256, parseAbi, toHex } from 'viem'
const READ_METHODS = new Set(['eth_chainId', 'web3_clientVersion', 'eth_blockNumber', 'eth_getBlockByNumber',
  'eth_getCode', 'eth_getStorageAt', 'eth_getTransactionCount', 'eth_call', 'eth_estimateGas', 'eth_gasPrice',
  'eth_getBalance', 'eth_getTransactionReceipt'])

export class LoopbackMiningPlan {
  rows = []
  contracts = {}
  constructor(owner, output, feeCap, fetcher = fetch) { this.owner = owner; this.output = output; this.feeCap = BigInt(feeCap); this.fetcher = fetcher; if (this.feeCap <= 0n) throw new Error('A verified fee cap is required') }
  async rpc(method, params = []) {
    let response
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await this.fetcher('http://127.0.0.1:8953', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(30_000) })
        break
      } catch (error) {
        // A fork may need an upstream storage read. Never retry a submission,
        // snapshot, mine, time advance or any other state-changing operation.
        if (!READ_METHODS.has(method) || attempt === 2) throw error
      }
    }
    const body = await response.json()
    if (!response.ok || body.id !== 1 || body.jsonrpc !== '2.0' || body.error) throw new Error(`Loopback ${method} failed: ${body.error?.message ?? response.status}`)
    return body.result
  }
  async start() {
    if (await this.rpc('eth_chainId') !== '0x7a0' || !/anvil/i.test(await this.rpc('web3_clientVersion'))) throw new Error('1952 Anvil fork required')
    this.startNonce = BigInt(await this.rpc('eth_getTransactionCount', [this.owner, 'latest']))
    if (this.startNonce !== 16n) throw new Error('Owner nonce differs from the verified phase boundary')
    await this.rpc('anvil_impersonateAccount', [this.owner])
    this.save()
  }
  async resume(saved) {
    if (await this.rpc('eth_chainId') !== '0x7a0' || !/anvil/i.test(await this.rpc('web3_clientVersion')) ||
      !saved.localForkOnly || saved.broadcast !== false || saved.chainId !== 1952 || saved.owner.toLowerCase() !== this.owner.toLowerCase() ||
      saved.startNonce !== '16' || saved.feeCap !== String(this.feeCap) ||
      JSON.stringify(saved.executionSourceSha256) !== JSON.stringify(this.executionSourceSha256)) throw new Error('Invalid local continuation; execution sources must match the complete rehearsal')
    const nonce = BigInt(await this.rpc('eth_getTransactionCount', [this.owner, 'latest']))
    if (nonce !== 16n + BigInt(saved.transactions.length)) throw new Error('Saved local continuation nonce differs')
    for (const record of Object.values(saved.contracts)) {
      if (keccak256(await this.rpc('eth_getCode', [record.address, 'latest'])) !== record.runtimeKeccak256) throw new Error('Saved local runtime differs')
    }
    this.startNonce = 16n; this.rows = saved.transactions; this.contracts = saved.contracts
    this.stack = saved.stack; this.miners = saved.miners; this.localSnapshot = saved.localSnapshot; this.business = saved.business
    this.permit2Proof = saved.permit2Proof; this.businessPrincipal = saved.businessPrincipal; this.preBusinessSnapshot = saved.preBusinessSnapshot
    await this.rpc('anvil_impersonateAccount', [this.owner])
    this.save()
  }
  save() { fs.writeFileSync(this.output, JSON.stringify({ schemaVersion: 1, chainId: 1952, localForkOnly: true, broadcast: false,
    owner: this.owner, startNonce: String(this.startNonce), feeCap: String(this.feeCap), contracts: this.contracts, stack: this.stack, permit2Proof: this.permit2Proof,
    executionSourceSha256: this.executionSourceSha256, preBusinessSnapshot: this.preBusinessSnapshot,
    localSnapshot: this.localSnapshot, miners: this.miners, business: this.business, businessPrincipal: this.businessPrincipal, failure: this.failure, additionalFeeUpperBound: this.additionalFeeUpperBound,
    totalFeeUpperBound: this.totalFeeUpperBound, budgetPassed: this.budgetPassed, transactions: this.rows,
    gasLimitSum: String(this.rows.reduce((sum, row) => sum + BigInt(row.gas), 0n)),
    executionFeeUpperBound: String(this.rows.reduce((sum, row) => sum + BigInt(row.gas) * this.feeCap, 0n)),
    publicChainAdditionalFees: 'must be bounded separately before broadcast',
  }, null, 2) + '\n') }
  async call(to, signature, args = [], block = 'latest') {
    const abi = parseAbi([signature]), item = abi[0]
    const raw = await this.rpc('eth_call', [{ to, data: encodeFunctionData({ abi, functionName: item.name, args }) }, block])
    return decodeFunctionResult({ abi, functionName: item.name, data: raw })
  }
  async mineAfterBlock() { await this.rpc('evm_mine') }
  async advanceRewards(seconds) { await this.rpc('evm_increaseTime', [seconds]); await this.rpc('evm_mine') }
  async readAbi(to, abi, functionName, args = [], block = 'latest') {
    const item = abi.find((entry) => entry.type === 'function' && entry.name === functionName)
    if (!item || !['view', 'pure'].includes(item.stateMutability)) throw new Error('Read ABI method required')
    const raw = await this.rpc('eth_call', [{ to, data: encodeFunctionData({ abi, functionName, args }) }, block])
    return decodeFunctionResult({ abi, functionName, data: raw })
  }
  async send(label, to, data, value = 0n) {
    const nonce = BigInt(await this.rpc('eth_getTransactionCount', [this.owner, 'latest']))
    if (nonce !== this.startNonce + BigInt(this.rows.length)) throw new Error('Fork nonce drifted')
    const tx = { from: this.owner, ...(to ? { to } : {}), data, value: toHex(value) }
    // A new block can accrue mining rewards and take a more expensive storage branch.
    await this.rpc('eth_call', [tx, 'pending'])
    const estimate = BigInt(await this.rpc('eth_estimateGas', [tx, 'pending']))
    // Creation code has fixed gas at this pinned fork; business writes retain 20% headroom.
    const margin = to ? 120n : 105n
    const gas = (estimate * margin + 99n) / 100n
    const hash = await this.rpc('eth_sendTransaction', [{ ...tx, nonce: toHex(nonce), gas: toHex(gas), gasPrice: toHex(this.feeCap) }])
    let receipt
    for (let attempts = 0; attempts < 30; attempts++) {
      receipt = await this.rpc('eth_getTransactionReceipt', [hash])
      if (receipt) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (!receipt) throw new Error('Fork transaction pending; do not rerun against an advanced fork')
    const row = { label, nonce: String(nonce), to: to ?? null, data, dataKeccak256: keccak256(data), value: String(value),
      gas: String(gas), estimatedGas: String(estimate), gasUsed: String(BigInt(receipt.gasUsed)), hash,
      created: receipt.contractAddress ?? null, status: receipt.status }
    this.rows.push(row); this.save()
    if (receipt.status !== '0x1') throw new Error(`Fork transaction reverted: ${label}`)
    return receipt
  }
  async write(label, to, signature, args = [], value = 0n) {
    const abi = parseAbi([signature])
    return this.send(label, to, encodeFunctionData({ abi, functionName: abi[0].name, args }), value)
  }
  async deploy(name, bytecode) {
    const receipt = await this.send(`Deploy ${name}`, undefined, bytecode)
    if (!receipt.contractAddress) throw new Error('Missing contract address')
    const code = await this.rpc('eth_getCode', [receipt.contractAddress, 'latest'])
    if (code === '0x') throw new Error('Missing deployed code')
    this.contracts[name] = { address: receipt.contractAddress, runtimeKeccak256: keccak256(code) }; this.save()
    return receipt.contractAddress
  }
}
